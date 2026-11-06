-- =====================================================================
-- GankStore — migrasi backend ke Supabase (project BARU khusus GankStore)
-- File 01: skema tabel (Postgres 15, Supabase)
--
-- JANGAN jalankan file ini ke project Supabase mana pun yang sudah ada
-- (apalagi project RekberSTORE) — hanya ke project BARU "GankStore"
-- yang dibuat khusus untuk migrasi ini (lihat PLAN.md).
-- Urutan: 01_schema.sql -> 02_rls.sql -> 03_functions.sql ->
--         04_settings_seed.sql (di SQL Editor Supabase, sebagai postgres).
--
-- Desain keamanan kredensial (inti migrasi ini):
--   * Kredensial akun game TIDAK PERNAH jadi kolom di tabel yang bisa
--     dibaca pembeli. Mereka tinggal di tabel terpisah:
--       - product_creds  (1:1 dengan products, hanya admin)
--       - order_creds    (1:1 dengan orders, TANPA policy baca sama
--         sekali — hanya fungsi SECURITY DEFINER yang boleh menyentuhnya)
--   * Kolom orders.cred_pending / cred_revealed hanya penanda boolean
--     (bukan rahasia) supaya frontend lama tetap jalan tanpa perubahan
--     bentuk data.
--   * Nama kolom dipertahankan sama dengan backend FastAPI lama
--     (invoice_no, buyer_email, created_at, ...) supaya mapper
--     frontend (serverProductToLocal / serverOrderToLocal) tidak berubah.
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles: profil pembeli/admin. 1:1 dengan auth.users (Supabase Auth).
-- is_admin HANYA diisi lewat SQL oleh pemilik toko (lihat PLAN.md) —
-- tidak ada jalur dari browser untuk menjadikan diri sendiri admin.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  name       text not null default '',
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- products: stok akun game. TIDAK ada kolom kredensial di sini.
-- specs memakai jsonb (dulu TEXT berisi JSON di SQLite).
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id          bigint generated always as identity primary key,
  game        text not null default 'Point Blank',
  title       text not null,
  rank        text not null default '',
  level       text not null default '',
  server      text not null default '',
  price       integer not null check (price >= 0),
  specs       jsonb not null default '[]'::jsonb,
  description text not null default '',
  photo       text not null default '',
  status      text not null default 'tersedia'
              check (status in ('tersedia', 'dipesan', 'terjual')),
  created_at  timestamptz not null default now()
);

-- Kredensial akun game untuk stok (email+password akun yang dijual).
-- Hanya admin yang boleh baca/tulis (kebijakan di 02_rls.sql).
create table if not exists public.product_creds (
  product_id bigint primary key references public.products (id) on delete cascade,
  cred_email text not null default '',
  cred_pass  text not null default ''
);

-- ---------------------------------------------------------------------
-- topup_packages: paket top up (diisi admin; katalog mulai kosong).
-- HARUS dibuat SEBELUM orders: orders.package_id punya foreign key
-- ke tabel ini (ditemukan saat apply 6 Nov 2026 — urutan lama gagal
-- dengan "relation public.topup_packages does not exist").
-- ---------------------------------------------------------------------
create table if not exists public.topup_packages (
  id         bigint generated always as identity primary key,
  game       text not null,
  name       text not null,
  amount     integer not null check (amount > 0),
  currency   text not null,
  price      integer not null check (price >= 0),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- orders: invoice akun + top up. TIDAK ada kolom kredensial di sini.
-- cred_pending/cred_revealed hanya penanda (bukan rahasia).
-- buyer_id null = pesanan tamu (tanpa login), seperti backend lama.
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id            bigint generated always as identity primary key,
  invoice_no    text not null unique,
  kind          text not null default 'akun' check (kind in ('akun', 'topup')),
  product_id    bigint references public.products (id) on delete set null,
  package_id    bigint references public.topup_packages (id) on delete set null,
  title         text not null,
  game          text not null,
  rank          text not null default '',
  price         integer not null,
  fee           integer not null,
  total         integer not null,
  photo         text not null default '',
  buyer_id      uuid references auth.users (id) on delete set null,
  buyer_name    text not null default '',
  buyer_email   text not null default '',
  user_id_game  text not null default '',
  server_id     text not null default '',
  package_name  text not null default '',
  amount        text not null default '',
  currency      text not null default '',
  status        text not null default 'dipesan'
                check (status in ('dipesan', 'terjual', 'dibatalkan')),
  cred_pending  boolean not null default false,
  cred_revealed boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Kredensial yang menunggu diambil pembeli (diisi saat Konfirmasi Lunas).
-- TIDAK ADA policy baca untuk tabel ini (lihat 02_rls.sql): hanya fungsi
-- SECURITY DEFINER reveal_order_credentials() yang boleh membaca, dan
-- fungsi itu MENGHAPUS barisnya dalam transaksi yang sama (tampil sekali).
create table if not exists public.order_creds (
  invoice_no text primary key references public.orders (invoice_no) on delete cascade,
  cred_email text not null,
  cred_pass  text not null
);

-- ---------------------------------------------------------------------
-- activity: umpan aktivitas toko (maks 100 baris terbaru, seperti lama).
-- ---------------------------------------------------------------------
create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  time       text not null,
  tag        text not null,
  text       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- support_messages: pesan "Hubungi Support" (Jarvis — Support GankStore).
-- Siapa pun boleh kirim (tanpa login); hanya admin yang boleh baca.
-- ---------------------------------------------------------------------
create table if not exists public.support_messages (
  id         bigint generated always as identity primary key,
  name       text not null,
  contact    text not null,
  topic      text not null
             check (topic in ('Pesanan', 'Pembayaran', 'Akun game', 'Top Up', 'Lainnya')),
  message    text not null,
  status     text not null default 'baru' check (status in ('baru', 'dibalas')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- settings: saklar toko yang bisa dibaca publik.
--   topup_maintenance : 'true' | 'false' (saat ini 'true' — Top Up
--                         masih MAINTENANCE, perintah Tuan 6 Nov 2026)
--   topup_games       : JSON daftar game top up (dipakai validasi server
--                         di fungsi create_topup_order; isinya disamakan
--                         dengan GS_CONFIG.TOPUP_GAMES di config.js)
--   midtrans_configured / midtrans_production / midtrans_client_key :
--                         penanda status Midtrans (client key BOLEH tampil
--                         di browser; Server Key TIDAK PERNAH ada di sini —
--                         Server Key hanya sebagai secret Edge Function).
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Nomor urut invoice. Format invoice dipertahankan sama dengan backend
-- lama: INV-YYYYMMDD-HHMMSS-<seq>. Sequence mulai dari 1000 supaya
-- nomor invoice baru tidak pernah bentrok dengan invoice lama (DB lama
-- saat ini 0 order, tapi jaga-jaga bila ada data lama yang diimpor).
-- ---------------------------------------------------------------------
create sequence if not exists public.invoice_seq as integer start with 1000;

-- ---------------------------------------------------------------------
-- Indeks
-- ---------------------------------------------------------------------
create index if not exists idx_orders_buyer_id   on public.orders (buyer_id);
create index if not exists idx_orders_status     on public.orders (status);
create index if not exists idx_orders_kind      on public.orders (kind);
create index if not exists idx_products_status   on public.products (status);
create index if not exists idx_products_game     on public.products (game);
create index if not exists idx_support_status    on public.support_messages (status);
create index if not exists idx_activity_created  on public.activity (created_at desc);

-- ---------------------------------------------------------------------
-- Trigger: setiap user baru di auth.users langsung dapat baris profiles.
-- Nama diambil dari user_metadata (diisi saat daftar / login Google).
-- SECURITY DEFINER supaya trigger boleh tulis ke public.profiles
-- walaupun RLS aktif.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Trigger: updated_at otomatis (orders, settings).
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists set_settings_updated_at on public.settings;
create trigger set_settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();
