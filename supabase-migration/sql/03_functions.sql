-- =====================================================================
-- GankStore — migrasi backend ke Supabase (project BARU khusus GankStore)
-- File 03: fungsi SECURITY DEFINER (logika bisnis yang harus atomik)
-- Jalankan SETELAH 02_rls.sql.
--
-- Semua fungsi di sini jalan sebagai owner (postgres) sehingga melewati
-- RLS — TAPI setiap fungsi memeriksa sendiri siapa pemanggilnya:
--   * fungsi pembeli (create_*_order, reveal_*) boleh dipanggil anon
--     dan authenticated; reveal_* memeriksa kepemilikan pesanan.
--   * fungsi admin (confirm_*, cancel_*, delete_*, relist_*) menolak
--     bila public.is_admin() false.
-- Pesan error memakai kode singkat (mis. 'forbidden') supaya adapter
-- frontend bisa memetakan ke pesan yang sama seperti backend lama.
--
-- Catatan pembulatan biaya admin: fee = round(harga * 0.10). Postgres
-- round() membulatkan 0.5 KE ATAS, sedangkan Python round() lama memakai
-- banker's rounding. Untuk harga kelipatan Rp5 ke atas hasilnya sama;
-- selisih hanya mungkin di harga yang 10%-nya tepat *.5 (mis. Rp1.005)
-- — harga toko praktisnya kelipatan Rp1.000, jadi tidak berpengaruh.
-- =====================================================================

-- ---------------------------------------------------------------------
-- log_activity: catat aktivitas + pangkas ke 100 baris terbaru.
-- Hanya dipanggil dari dalam fungsi lain / Edge Function — tidak ada
-- pemanggilan langsung dari browser.
-- ---------------------------------------------------------------------
create or replace function public.log_activity(p_tag text, p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity (time, tag, text)
  values (to_char(now(), 'HH24:MI:SS'), p_tag, p_text);
  delete from public.activity
  where id not in (select id from public.activity order by id desc limit 100);
end;
$$;

-- ---------------------------------------------------------------------
-- Buat nomor invoice, format sama dengan backend lama:
-- INV-YYYYMMDD-HHMMSS-<seq>
-- ---------------------------------------------------------------------
create or replace function public.next_invoice_no()
returns text
language sql
security definer
set search_path = public
as $$
  select 'INV-' || to_char(now(), 'YYYYMMDD-HH24MISS-') || nextval('public.invoice_seq')::text;
$$;

-- ---------------------------------------------------------------------
-- create_account_order: pembeli (boleh tamu) memesan satu akun.
-- Atomik: kunci baris produk, pastikan masih 'tersedia', hitung biaya
-- admin 10%, terbitkan invoice, ubah produk jadi 'dipesan'.
-- Return: baris orders sebagai JSON (bentuk sama seperti backend lama).
-- ---------------------------------------------------------------------
create or replace function public.create_account_order(p_product_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_fee integer;
  v_invoice text;
  v_order public.orders%rowtype;
  v_uid uuid := auth.uid();
  v_email text := '';
  v_name text := 'Pembeli tamu';
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product_not_found';
  end if;
  if v_product.status <> 'tersedia' then
    raise exception 'product_not_available';
  end if;

  if v_uid is not null then
    select u.email into v_email from auth.users u where u.id = v_uid;
    select p.name into v_name from public.profiles p where p.id = v_uid;
    v_name := coalesce(nullif(v_name, ''), 'Pembeli');
    v_email := coalesce(v_email, '');
  end if;

  v_fee := round(v_product.price * 0.10)::integer;
  v_invoice := public.next_invoice_no();

  insert into public.orders
    (invoice_no, kind, product_id, title, game, rank, price, fee, total,
     photo, buyer_id, buyer_name, buyer_email)
  values
    (v_invoice, 'akun', v_product.id, v_product.title, v_product.game,
     v_product.rank, v_product.price, v_fee, v_product.price + v_fee,
     v_product.photo, v_uid, v_name, v_email)
  returning * into v_order;

  update public.products set status = 'dipesan' where id = v_product.id;

  perform public.log_activity(
    'pesan',
    'Akun "' || v_product.title || '" dipesan — invoice ' || v_invoice ||
    ' terbit. Menunggu pembayaran via QRIS manual.'
  );
  return row_to_json(v_order)::jsonb;
end;
$$;

-- ---------------------------------------------------------------------
-- create_topup_order: pembeli (boleh tamu) memesan paket top up.
-- Menolak bila settings.topup_maintenance = 'true' (saat ini 'true').
-- Memeriksa needsServer dari settings.topup_games (JSON daftar game).
-- ---------------------------------------------------------------------
create or replace function public.create_topup_order(
  p_package_id bigint, p_user_id_game text, p_server_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg public.topup_packages%rowtype;
  v_maint text;
  v_games jsonb;
  v_needs_server boolean := false;
  v_fee integer;
  v_invoice text;
  v_order public.orders%rowtype;
  v_uid uuid := auth.uid();
  v_email text := '';
  v_name text := 'Pembeli tamu';
begin
  select value into v_maint from public.settings where key = 'topup_maintenance';
  if coalesce(v_maint, 'true') = 'true' then
    raise exception 'topup_maintenance';
  end if;

  select * into v_pkg from public.topup_packages where id = p_package_id;
  if not found then
    raise exception 'package_not_found';
  end if;

  select value::jsonb into v_games from public.settings where key = 'topup_games';
  if v_games is not null then
    select coalesce(bool_or((g ->> 'needsServer')::boolean), false)
      into v_needs_server
    from jsonb_array_elements(v_games) g
    where g ->> 'name' = v_pkg.game;
  end if;
  if v_needs_server and (p_server_id is null or btrim(p_server_id) = '') then
    raise exception 'server_id_required';
  end if;

  if v_uid is not null then
    select u.email into v_email from auth.users u where u.id = v_uid;
    select p.name into v_name from public.profiles p where p.id = v_uid;
    v_name := coalesce(nullif(v_name, ''), 'Pembeli');
    v_email := coalesce(v_email, '');
  end if;

  v_fee := round(v_pkg.price * 0.10)::integer;
  v_invoice := public.next_invoice_no();

  insert into public.orders
    (invoice_no, kind, package_id, title, game, price, fee, total,
     buyer_id, buyer_name, buyer_email, user_id_game, server_id,
     package_name, amount, currency)
  values
    (v_invoice, 'topup', v_pkg.id,
     'Top Up ' || v_pkg.amount || ' ' || v_pkg.currency || ' — ' || v_pkg.game,
     v_pkg.game, v_pkg.price, v_fee, v_pkg.price + v_fee,
     v_uid, v_name, v_email, btrim(coalesce(p_user_id_game, '')), btrim(coalesce(p_server_id, '')),
     v_pkg.name, v_pkg.amount::text, v_pkg.currency)
  returning * into v_order;

  perform public.log_activity(
    'pesan',
    'Top up "' || v_order.title || '" dipesan — invoice ' || v_invoice ||
    ' terbit. Menunggu pembayaran via QRIS manual.'
  );
  return row_to_json(v_order)::jsonb;
end;
$$;

-- ---------------------------------------------------------------------
-- confirm_order: admin mengonfirmasi lunas (atau webhook Midtrans
-- memanggil logika yang sama dari Edge Function).
-- Akun: produk jadi 'terjual', kredensial PINDAH dari product_creds ke
-- order_creds (lalu dihapus dari stok), orders.cred_pending = true.
-- ---------------------------------------------------------------------
create or replace function public.confirm_order(p_invoice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_cred public.product_creds%rowtype;
  v_has_cred boolean := false;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_order from public.orders where invoice_no = p_invoice for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if v_order.status <> 'dipesan' then
    raise exception 'order_not_dipesan';
  end if;

  update public.orders
  set status = 'terjual', updated_at = now()
  where invoice_no = p_invoice;

  if v_order.kind = 'akun' and v_order.product_id is not null then
    update public.products set status = 'terjual' where id = v_order.product_id;

    select * into v_cred from public.product_creds where product_id = v_order.product_id;
    if found and v_cred.cred_email <> '' and v_cred.cred_pass <> '' then
      v_has_cred := true;
      insert into public.order_creds (invoice_no, cred_email, cred_pass)
      values (p_invoice, v_cred.cred_email, v_cred.cred_pass)
      on conflict (invoice_no) do update
        set cred_email = excluded.cred_email, cred_pass = excluded.cred_pass;
      update public.orders
      set cred_pending = true, updated_at = now()
      where invoice_no = p_invoice;
      delete from public.product_creds where product_id = v_order.product_id;
    end if;
  end if;

  perform public.log_activity(
    'lunas',
    'Pembayaran lunas dikonfirmasi — "' || v_order.title || '" resmi TERJUAL.'
  );

  select * into v_order from public.orders where invoice_no = p_invoice;
  return row_to_json(v_order)::jsonb;
end;
$$;

-- ---------------------------------------------------------------------
-- cancel_order: admin membatalkan pesanan 'dipesan'. Akun kembali
-- 'tersedia'; kredensial TETAP di stok (tidak dihapus).
-- ---------------------------------------------------------------------
create or replace function public.cancel_order(p_invoice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_order from public.orders where invoice_no = p_invoice for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if v_order.status <> 'dipesan' then
    raise exception 'order_not_dipesan';
  end if;

  update public.orders
  set status = 'dibatalkan', updated_at = now()
  where invoice_no = p_invoice;

  if v_order.kind = 'akun' and v_order.product_id is not null then
    update public.products set status = 'tersedia' where id = v_order.product_id;
  end if;

  perform public.log_activity(
    'batal',
    'Pesanan "' || v_order.title || '" dibatalkan admin.'
  );

  select * into v_order from public.orders where invoice_no = p_invoice;
  return row_to_json(v_order)::jsonb;
end;
$$;

-- ---------------------------------------------------------------------
-- delete_product: admin menghapus stok. Ditolak bila ada pesanan aktif
-- ('dipesan') untuk produk itu — sama seperti backend lama (HTTP 409).
-- ---------------------------------------------------------------------
create or replace function public.delete_product(p_product_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if exists (
    select 1 from public.orders
    where product_id = p_product_id and status = 'dipesan'
  ) then
    raise exception 'product_has_active_order';
  end if;
  delete from public.products where id = p_product_id;
end;
$$;

-- ---------------------------------------------------------------------
-- relist_product: admin memajang lagi akun yang sudah terjual.
-- PERHATIAN: bila kredensialnya sudah terhapus saat penjualan
-- sebelumnya, produk kembali 'tersedia' TANPA kredensial — admin wajib
-- hapus & tambah ulang dengan kredensial baru (sama seperti backend
-- lama; frontend sudah menampilkan peringatan ini).
-- ---------------------------------------------------------------------
create or replace function public.relist_product(p_product_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  update public.products set status = 'tersedia' where id = p_product_id
  returning * into v_product;
  if not found then
    raise exception 'product_not_found';
  end if;
  return row_to_json(v_product)::jsonb;
end;
$$;

-- ---------------------------------------------------------------------
-- reveal_order_credentials: tampilkan kredensial SATU KALI lalu hapus.
-- Hanya untuk pesanan akun yang sudah 'terjual' dan kredensialnya
-- menunggu (cred_pending). Yang boleh: admin, atau pembeli pesanan itu
-- sendiri (buyer_id = auth.uid()). Satu transaksi: baca -> hapus ->
-- tandai cred_revealed — jadi tidak ada cara menampilkan dua kali,
-- bahkan bila dua permintaan datang bersamaan (baris dikunci).
-- Error:
--   not_found        = invoice tidak ada
--   not_paid         = pesanan belum lunas
--   not_account_order = pesanan ini bukan pembelian akun
--   forbidden        = bukan pembeli pesanan ini (dan bukan admin)
--   already_revealed = kredensial sudah pernah ditampilkan / tidak ada
-- ---------------------------------------------------------------------
create or replace function public.reveal_order_credentials(p_invoice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_cred public.order_creds%rowtype;
begin
  select * into v_order from public.orders where invoice_no = p_invoice for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_order.status <> 'terjual' then
    raise exception 'not_paid';
  end if;
  if v_order.kind <> 'akun' then
    raise exception 'not_account_order';
  end if;
  if not public.is_admin() then
    if v_order.buyer_id is null or v_order.buyer_id <> auth.uid() then
      raise exception 'forbidden';
    end if;
  end if;

  select * into v_cred from public.order_creds where invoice_no = p_invoice for update;
  if not found then
    raise exception 'already_revealed';
  end if;

  delete from public.order_creds where invoice_no = p_invoice;
  update public.orders
  set cred_pending = false, cred_revealed = true, updated_at = now()
  where invoice_no = p_invoice;

  return jsonb_build_object('email', v_cred.cred_email, 'password', v_cred.cred_pass);
end;
$$;

-- ---------------------------------------------------------------------
-- Hak eksekusi. Fungsi pembeli boleh dipanggil anon (tamu bisa beli
-- tanpa login, seperti backend lama); fungsi admin hanya untuk user
-- login — pemeriksaan is_admin() tetap di dalam fungsi.
-- ---------------------------------------------------------------------
grant execute on function public.log_activity(text, text) to authenticated;
grant execute on function public.next_invoice_no() to authenticated;
grant execute on function public.create_account_order(bigint) to anon, authenticated;
grant execute on function public.create_topup_order(bigint, text, text) to anon, authenticated;
grant execute on function public.confirm_order(text) to authenticated;
grant execute on function public.cancel_order(text) to authenticated;
grant execute on function public.delete_product(bigint) to authenticated;
grant execute on function public.relist_product(bigint) to authenticated;
grant execute on function public.reveal_order_credentials(text) to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
