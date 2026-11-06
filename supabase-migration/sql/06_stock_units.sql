-- =====================================================================
-- GankStore — model stok unit (perintah Tuan 6 Nov 2026 23:08 WIB)
-- File 06: products = LISTING, stock_units = unit stok (1 baris = 1 akun)
-- Jalankan SETELAH 01–04 (file 05 hanya catatan migrasi data).
-- Project: GankStore BARU (fbncsifwelllkpvoxmfe) — JANGAN ke project lain.
--
-- Ringkas (desain lengkap: PLAN-stock-units.md):
--   * products tidak lagi mewakili 1 akun — ia listing. Stok tinggal di
--     stock_units (username + password PB, BUKAN email).
--   * products.status jadi cerminan jumlah unit, dihitung ulang otomatis
--     oleh trigger setiap unit berubah (tersedia/dipesan/terjual/habis).
--   * Beli mengklaim 1 unit tersedia secara atomik (FOR UPDATE SKIP
--     LOCKED) — dua pembeli tidak bisa dapat unit yang sama.
--   * Kredensial tetap di tabel terpisah tanpa policy baca publik:
--     stock_units (admin saja, seperti product_creds dulu),
--     order_creds (tanpa policy sama sekali, hanya RPC reveal).
--   * product_creds DITINGGALKAN: isinya dipindah ke stock_units di
--     file ini (cred_email lama menjadi cred_user unit), lalu barisnya
--     dihapus. Tabelnya dibiarkan kosong untuk jaga-jaga.
--   * order_creds.cred_email diganti nama jadi cred_user (data tetap).
--
-- Idempotent sebisa mungkin: IF NOT EXISTS / CREATE OR REPLACE / guard
-- DO untuk rename kolom & migrasi data. Aman dijalankan ulang bila
-- gagal di tengah jalan (langkah migrasi data hanya jalan bila masih
-- ada baris product_creds yang belum dipindah).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. products.status boleh 'habis' (listing tanpa unit sama sekali).
--    Hapus CHECK lama (nama constraint auto-generated Postgres) lalu
--    pasang yang baru. Guard DO: bila dijalankan ulang, CHECK baru
--    ikut terhapus lalu dipasang lagi — tetap idempotent.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.products'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%tersedia%'
  loop
    execute 'alter table public.products drop constraint ' || quote_ident(r.conname);
  end loop;
end $$;

alter table public.products
  add constraint products_status_check
  check (status in ('tersedia', 'dipesan', 'terjual', 'habis'));

-- ---------------------------------------------------------------------
-- 2. order_creds.cred_email -> cred_user (rename kolom, data tetap).
--    Guard: hanya bila kolom lama masih ada.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_creds'
      and column_name = 'cred_email'
  ) then
    alter table public.order_creds rename column cred_email to cred_user;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. stock_units: 1 baris = 1 akun Point Blank yang dijual.
--    cred_user = USERNAME akun PB (bukan email). order_invoice menandai
--    unit yang sedang dipesan (null = bebas).
-- ---------------------------------------------------------------------
create table if not exists public.stock_units (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references public.products (id) on delete cascade,
  cred_user     text not null default '',
  cred_pass     text not null default '',
  status        text not null default 'tersedia'
                check (status in ('tersedia', 'dipesan', 'terjual')),
  order_invoice text references public.orders (invoice_no) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_stock_units_product on public.stock_units (product_id);
create index if not exists idx_stock_units_status  on public.stock_units (product_id, status);
create index if not exists idx_stock_units_invoice on public.stock_units (order_invoice);

-- RLS: admin saja (pola sama seperti product_creds dulu). Pembeli
-- TIDAK BISA membaca unit lewat API — mereka hanya melihat jumlah
-- stok lewat RPC get_stock_counts() di bawah.
alter table public.stock_units enable row level security;
drop policy if exists "stock_units_all_admin" on public.stock_units;
create policy "stock_units_all_admin"
  on public.stock_units for all
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.stock_units from anon, authenticated;
grant all on public.stock_units to authenticated;

-- ---------------------------------------------------------------------
-- 4. refresh_product_status: hitung ulang status listing dari unitnya.
--      ada unit tersedia            -> 'tersedia'
--      0 tersedia, ada yang dipesan -> 'dipesan'
--      0 tersedia/dipesan, ada yang terjual -> 'terjual'
--      0 unit, tapi pernah ada order terjual -> 'terjual' (riwayat)
--      0 unit, belum pernah terjual -> 'habis'
-- ---------------------------------------------------------------------
create or replace function public.refresh_product_status(p_product_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_av int; v_di int; v_te int; v_total int; v_status text;
begin
  select
    count(*) filter (where status = 'tersedia'),
    count(*) filter (where status = 'dipesan'),
    count(*) filter (where status = 'terjual'),
    count(*)
  into v_av, v_di, v_te, v_total
  from public.stock_units where product_id = p_product_id;

  if v_total = 0 then
    if exists (
      select 1 from public.orders
      where product_id = p_product_id and kind = 'akun' and status = 'terjual'
    ) then v_status := 'terjual';
    else v_status := 'habis';
    end if;
  elsif v_av > 0 then v_status := 'tersedia';
  elsif v_di > 0 then v_status := 'dipesan';
  else v_status := 'terjual';
  end if;

  update public.products set status = v_status where id = p_product_id;
  return v_status;
end;
$$;

-- Trigger: setiap unit berubah (tambah/klaim/lunas/batal/hapus),
-- status listing langsung sinkron — RPC tidak perlu mengurusnya lagi.
create or replace function public.sync_product_status_from_units()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.refresh_product_status(old.product_id);
    return old;
  end if;
  perform public.refresh_product_status(new.product_id);
  return new;
end;
$$;

drop trigger if exists stock_units_status_sync on public.stock_units;
create trigger stock_units_status_sync
  after insert or update or delete on public.stock_units
  for each row execute function public.sync_product_status_from_units();

-- ---------------------------------------------------------------------
-- 5. MIGRASI DATA LAMA (satu transaksi implisit per DO block):
--    product_creds -> stock_units. Nilai cred_email lama menjadi
--    cred_user unit (catat: username unit hasil migrasi = nilai email
--    lama apa adanya — mis. produk live Rp800.000 mendapat unit
--    cred_user '986qqrb@gmail.com'. Bila username PB aslinya berbeda,
--    admin hapus unit itu dan tambah unit baru yang benar).
--    Produk 'dipesan' ikut membawa invoice aktifnya ke unit.
--    Verifikasi jumlah: bila tidak sama, RAISE (rollback).
-- ---------------------------------------------------------------------
do $$
declare
  v_source int := 0;
  v_migrated int := 0;
begin
  select count(*) into v_source
  from public.product_creds
  where btrim(coalesce(cred_email, '')) <> ''
     or btrim(coalesce(cred_pass, '')) <> '';

  if v_source > 0 then
    insert into public.stock_units (product_id, cred_user, cred_pass, status, order_invoice)
    select
      c.product_id,
      c.cred_email,
      c.cred_pass,
      case p.status
        when 'dipesan' then 'dipesan'
        when 'terjual' then 'terjual'
        else 'tersedia'
      end,
      (select o.invoice_no from public.orders o
        where o.product_id = c.product_id and o.status = 'dipesan'
        order by o.id desc limit 1)
    from public.product_creds c
    join public.products p on p.id = c.product_id
    where btrim(coalesce(c.cred_email, '')) <> ''
       or btrim(coalesce(c.cred_pass, '')) <> '';

    get diagnostics v_migrated = row_count;
    if v_migrated <> v_source then
      raise exception 'migrasi product_creds gagal: % dari % baris terpindah', v_migrated, v_source;
    end if;

    -- Hapus HANYA baris yang sudah terpindah (cocok persis).
    delete from public.product_creds c
    where exists (
      select 1 from public.stock_units u
      where u.product_id = c.product_id
        and u.cred_user = c.cred_email
        and u.cred_pass = c.cred_pass
    );
  end if;
end $$;

-- Hitung ulang status SEMUA listing dari unitnya (jaga-jaga bila ada
-- produk yang statusnya sudah tidak cocok, mis. 'terjual' tanpa unit).
do $$
declare r record;
begin
  for r in select id from public.products loop
    perform public.refresh_product_status(r.id);
  end loop;
end $$;

-- product_creds kini kosong dan tidak dipakai lagi oleh fungsi mana pun
-- (deprecated — boleh di-DROP pada migrasi berikutnya).
comment on table public.product_creds is
  'DEPRECATED sejak 06_stock_units.sql — kredensial pindah ke stock_units. Tabel dibiarkan kosong untuk jaga-jaga.';

-- ---------------------------------------------------------------------
-- 6. RPC: get_stock_counts — jumlah unit per produk (ANGKA SAJA, tanpa
--    kredensial). Boleh dipanggil anon: dipakai katalog untuk badge
--    "Stok: N".
-- ---------------------------------------------------------------------
create or replace function public.get_stock_counts()
returns table (product_id bigint, available bigint, dipesan bigint, terjual bigint, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(sum(case when u.status = 'tersedia' then 1 else 0 end), 0),
    coalesce(sum(case when u.status = 'dipesan' then 1 else 0 end), 0),
    coalesce(sum(case when u.status = 'terjual' then 1 else 0 end), 0),
    coalesce(count(u.id), 0)
  from public.products p
  left join public.stock_units u on u.product_id = p.id
  group by p.id
  order by p.id;
$$;

-- ---------------------------------------------------------------------
-- 7. RPC: add_stock_units — admin menambah N unit ke listing yang ada.
--    p_units: jsonb array [{username, password}, ...]. Satu transaksi:
--    bila satu baris tidak valid, semuanya batal. Trigger mengembalikan
--    status listing ke 'tersedia' bila tadinya habis/terjual.
-- ---------------------------------------------------------------------
create or replace function public.add_stock_units(p_product_id bigint, p_units jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_n int := 0;
  v_u jsonb;
  v_user text;
  v_pass text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'product_not_found';
  end if;

  if p_units is null or jsonb_typeof(p_units) <> 'array'
     or jsonb_array_length(p_units) = 0 then
    raise exception 'units_required';
  end if;

  for v_u in select * from jsonb_array_elements(p_units) loop
    v_user := btrim(coalesce(v_u ->> 'username', ''));
    v_pass := coalesce(v_u ->> 'password', '');
    if v_user = '' or v_pass = '' then
      raise exception 'unit_invalid';
    end if;
    insert into public.stock_units (product_id, cred_user, cred_pass, status)
    values (p_product_id, v_user, v_pass, 'tersedia');
    v_n := v_n + 1;
  end loop;

  perform public.log_activity(
    'stok',
    'Stok ditambah: ' || v_n || ' unit untuk "' || v_product.title || '".'
  );
  return jsonb_build_object('product_id', p_product_id, 'added', v_n);
end;
$$;

-- ---------------------------------------------------------------------
-- 8. RPC: delete_stock_unit — admin menghapus 1 unit yang masih
--    'tersedia' saja. Unit 'dipesan'/'terjual' terikat pesanan.
-- ---------------------------------------------------------------------
create or replace function public.delete_stock_unit(p_unit_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.stock_units%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_unit from public.stock_units where id = p_unit_id for update;
  if not found then
    raise exception 'unit_not_found';
  end if;
  if v_unit.status <> 'tersedia' then
    raise exception 'unit_not_available';
  end if;

  delete from public.stock_units where id = p_unit_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. RPC: create_account_order — GANTI versi 03 (klaim UNIT, bukan
--    produk). Kunci 1 unit 'tersedia' (SKIP LOCKED) supaya dua pembeli
--    yang klik bersamaan tidak dapat unit yang sama. Listing tetap
--    'tersedia' selama sisa unit > 0 (status diurus trigger).
-- ---------------------------------------------------------------------
create or replace function public.create_account_order(p_product_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_unit public.stock_units%rowtype;
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

  select * into v_unit from public.stock_units
  where product_id = p_product_id and status = 'tersedia'
  order by id asc limit 1 for update skip locked;
  if not found then
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

  update public.stock_units
  set status = 'dipesan', order_invoice = v_invoice
  where id = v_unit.id;

  perform public.log_activity(
    'pesan',
    'Akun "' || v_product.title || '" dipesan — invoice ' || v_invoice ||
    ' terbit. Menunggu pembayaran via Midtrans.'
  );
  return row_to_json(v_order)::jsonb;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. RPC: confirm_order — GANTI versi 03 (pindah kredensial UNIT,
--     bukan product_creds). Unit yang terikat invoice jadi 'terjual',
--     username+password-nya pindah ke order_creds.
-- ---------------------------------------------------------------------
create or replace function public.confirm_order(p_invoice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_unit public.stock_units%rowtype;
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
    select * into v_unit
    from public.stock_units
    where order_invoice = p_invoice for update;

    if found and v_unit.cred_user <> '' and v_unit.cred_pass <> '' then
      v_has_cred := true;
      insert into public.order_creds (invoice_no, cred_user, cred_pass)
      values (p_invoice, v_unit.cred_user, v_unit.cred_pass)
      on conflict (invoice_no) do update
        set cred_user = excluded.cred_user, cred_pass = excluded.cred_pass;
      update public.orders
      set cred_pending = true, updated_at = now()
      where invoice_no = p_invoice;
      -- Unit tetap terikat invoice ini (jejak audit unit mana yang
      -- terjual); statusnya jadi 'terjual', trigger menghitung ulang
      -- status listing.
      update public.stock_units set status = 'terjual' where id = v_unit.id;
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
-- 11. RPC: cancel_order — GANTI versi 03 (unit kembali 'tersedia',
--     kredensial TETAP di stok).
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
    update public.stock_units
    set status = 'tersedia', order_invoice = null
    where order_invoice = p_invoice;
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
-- 12. RPC: delete_product — GANTI versi 03 (tolak bila ada unit
--     'dipesan' ATAU order 'dipesan'). Unit ikut terhapus (cascade).
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
    select 1 from public.stock_units
    where product_id = p_product_id and status = 'dipesan'
  ) then
    raise exception 'product_has_active_order';
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
-- 13. RPC: relist_product — GANTI versi 03. Di model unit, "pajang
--     lagi" tidak lagi relevan (listing hidup selama ada stok; tambah
--     stok saja). Fungsi ini dipertahankan untuk kompatibilitas: ia
--     hanya menghitung ulang status listing dari unitnya.
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
  perform public.refresh_product_status(p_product_id);
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'product_not_found';
  end if;
  return row_to_json(v_product)::jsonb;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. RPC: reveal_order_credentials — GANTI versi 03 (kunci kembalian
--     'username', bukan 'email'; kolom order_creds sudah diganti nama).
--     Tampil SATU KALI, baca + hapus satu transaksi (tidak berubah).
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

  return jsonb_build_object('username', v_cred.cred_user, 'password', v_cred.cred_pass);
end;
$$;

-- ---------------------------------------------------------------------
-- 15. Hak eksekusi.
-- ---------------------------------------------------------------------
grant execute on function public.refresh_product_status(bigint) to authenticated;
grant execute on function public.get_stock_counts() to anon, authenticated;
grant execute on function public.add_stock_units(bigint, jsonb) to authenticated;
grant execute on function public.delete_stock_unit(bigint) to authenticated;
grant execute on function public.create_account_order(bigint) to anon, authenticated;
grant execute on function public.confirm_order(text) to authenticated;
grant execute on function public.cancel_order(text) to authenticated;
grant execute on function public.delete_product(bigint) to authenticated;
grant execute on function public.relist_product(bigint) to authenticated;
grant execute on function public.reveal_order_credentials(text) to authenticated;
