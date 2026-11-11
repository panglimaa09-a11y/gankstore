-- Patch 07 — teks log aktivitas pesanan: "via Midtrans" -> "via QRIS manual".
-- Hanya mengubah 1 baris teks di tiap fungsi; logika lain TIDAK berubah.
-- Jalankan di Supabase SQL Editor (project GankStore).

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
