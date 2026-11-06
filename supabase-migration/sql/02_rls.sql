-- =====================================================================
-- GankStore — migrasi backend ke Supabase (project BARU khusus GankStore)
-- File 02: Row Level Security (RLS) + hak akses
-- Jalankan SETELAH 01_schema.sql.
--
-- Prinsip (sama dengan backend FastAPI lama, tapi ditegakkan database):
--   * Katalog produk & paket top up: bisa dibaca siapa pun (tamu pun).
--   * Kredensial akun game: TIDAK PERNAH bisa dibaca pembeli — mereka
--     tinggal di product_creds (admin saja) dan order_creds (TANPA
--     policy sama sekali; hanya fungsi SECURITY DEFINER yang menyentuhnya).
--   * Pesanan: pembeli hanya melihat pesanannya sendiri; admin semua.
--   * Tulis pesanan HANYA lewat fungsi di 03_functions.sql (tidak ada
--     policy INSERT/UPDATE langsung untuk orders) supaya perubahan
--     status produk + pembuatan invoice selalu atomik.
--   * Pesan support: siapa pun boleh kirim; hanya admin yang boleh baca.
--   * Admin = profiles.is_admin = true (diisi lewat SQL oleh pemilik
--     toko — tidak ada jalur dari browser untuk jadi admin).
-- =====================================================================

alter table public.profiles         enable row level security;
alter table public.products         enable row level security;
alter table public.product_creds    enable row level security;
alter table public.orders           enable row level security;
alter table public.order_creds      enable row level security;
alter table public.topup_packages   enable row level security;
alter table public.activity         enable row level security;
alter table public.support_messages enable row level security;
alter table public.settings         enable row level security;

-- ---------------------------------------------------------------------
-- Helper: apakah pemanggil saat ini admin toko?
-- SECURITY DEFINER supaya baca profiles tidak kena RLS sendiri
-- (tanpa ini, policy yang memanggil is_admin() akan rekursi).
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin
  );
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_select_admin"
  on public.profiles for select
  using (public.is_admin());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- products (katalog publik; tulis hanya admin)
-- ---------------------------------------------------------------------
create policy "products_select_public"
  on public.products for select
  using (true);

create policy "products_insert_admin"
  on public.products for insert
  with check (public.is_admin());

create policy "products_update_admin"
  on public.products for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "products_delete_admin"
  on public.products for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- product_creds (kredensial stok — admin saja, semua operasi)
-- ---------------------------------------------------------------------
create policy "product_creds_all_admin"
  on public.product_creds for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- orders (baca: pemilik pesanan atau admin; tulis: HANYA via fungsi
-- SECURITY DEFINER di 03_functions.sql — sengaja TIDAK ADA policy
-- insert/update/delete di sini)
-- ---------------------------------------------------------------------
create policy "orders_select_own_or_admin"
  on public.orders for select
  using (public.is_admin() or buyer_id = auth.uid());

-- ---------------------------------------------------------------------
-- order_creds — SENGAJA TANPA POLICY SAMA SEKALI.
-- Dengan RLS aktif dan nol policy, TIDAK ADA role (anon/authenticated)
-- yang bisa SELECT/INSERT/UPDATE/DELETE tabel ini lewat API.
-- Satu-satunya jalan: fungsi SECURITY DEFINER di 03_functions.sql
-- (confirm_order menulis, reveal_order_credentials membaca + menghapus
-- dalam satu transaksi) dan Edge Function Midtrans (service_role).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- topup_packages (baca publik; tulis hanya admin)
-- ---------------------------------------------------------------------
create policy "packages_select_public"
  on public.topup_packages for select
  using (true);

create policy "packages_insert_admin"
  on public.topup_packages for insert
  with check (public.is_admin());

create policy "packages_update_admin"
  on public.topup_packages for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "packages_delete_admin"
  on public.topup_packages for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- activity (umpan live — bisa dibaca siapa pun, sama seperti backend
-- lama yang mengizinkan tamu membaca /api/activity; tulis hanya lewat
-- fungsi log_activity di 03_functions.sql — tidak ada policy insert)
-- ---------------------------------------------------------------------
create policy "activity_select_public"
  on public.activity for select
  using (true);

-- ---------------------------------------------------------------------
-- support_messages (kirim: siapa pun; baca/ubah: admin saja)
-- ---------------------------------------------------------------------
create policy "support_insert_public"
  on public.support_messages for insert
  with check (true);

create policy "support_select_admin"
  on public.support_messages for select
  using (public.is_admin());

create policy "support_update_admin"
  on public.support_messages for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- settings (baca publik; tulis hanya admin)
-- ---------------------------------------------------------------------
create policy "settings_select_public"
  on public.settings for select
  using (true);

create policy "settings_write_admin"
  on public.settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Hak akses (grants). RLS tetap yang menegakkan aturan; grant di sini
-- hanya membuka pintu API. order_creds sengaja dicabut dari anon dan
-- authenticated — fungsi SECURITY DEFINER (owner postgres) tetap bisa.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

revoke all on public.product_creds from anon, authenticated;
grant all on public.product_creds to authenticated;

grant select on public.orders to anon, authenticated;

revoke all on public.order_creds from anon, authenticated;

grant select on public.topup_packages to anon, authenticated;
grant insert, update, delete on public.topup_packages to authenticated;

grant select on public.activity to anon, authenticated;

grant insert on public.support_messages to anon, authenticated;
grant select, update on public.support_messages to authenticated;

grant select on public.settings to anon, authenticated;
grant insert, update, delete on public.settings to authenticated;

grant usage, select on sequence public.invoice_seq to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
