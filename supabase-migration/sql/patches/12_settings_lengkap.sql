-- =====================================================================
-- GankStore — patch 12: Pengaturan Toko lengkap (12 Nov 2026)
-- Jalankan di SQL Editor Supabase (sebagai postgres). Aman diulang.
--
-- 1) Settings baru untuk halaman Pengaturan Toko: profil toko, tarif
--    biaya admin (%), saklar tutup toko, pengumuman beranda.
-- 2) Helper public.admin_fee_rate(): baca settings.admin_fee_rate
--    (teks desimal, mis. '0.10'), dijepit 0–0.50, fallback 0.10 bila
--    kosong/rusak. Dipakai KEDUA fungsi order di bawah supaya tarif yang
--    diubah admin di Pengaturan langsung berlaku di invoice baru —
--    server dan aplikasi menghitung dari angka yang sama.
-- 3) create_account_order + create_topup_order didefinisi ulang PERSIS
--    seperti 03_functions.sql, HANYA baris v_fee yang berubah.
--    (Bukti: patch ini digenerate dari file 03 tersebut.)
-- =====================================================================

insert into public.settings (key, value) values
  ('store_name', 'GankStore'),
  ('store_tagline', 'Toko akun game — Point Blank dulu.'),
  ('store_whatsapp', '6289681992892'),
  ('store_email', 'panglimaa09@gmail.com'),
  ('store_telegram', ''),
  ('admin_fee_rate', '0.10'),
  ('store_closed', 'false'),
  ('announcement', '')
on conflict (key) do nothing;

create or replace function public.admin_fee_rate()
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
  r numeric;
begin
  select value into v from public.settings where key = 'admin_fee_rate';
  r := coalesce(nullif(btrim(coalesce(v, '')), '')::numeric, 0.10);
  if r < 0 then r := 0; end if;
  if r > 0.50 then r := 0.50; end if;
  return r;
exception when others then
  return 0.10;
end;
$$;

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

  v_fee := round(v_product.price * public.admin_fee_rate())::integer;
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

  v_fee := round(v_pkg.price * public.admin_fee_rate())::integer;
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
