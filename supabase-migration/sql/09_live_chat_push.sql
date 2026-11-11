-- GankStore — migrasi 09: live chat tanpa AI + push notification PWA.
--  - live_chats: satu baris per percakapan pembeli (id UUID dipegang pembeli
--    di localStorage; UUID tidak bisa ditebak, jadi anon boleh baca/tulis
--    barisnya sendiri — pola sama seperti support_messages yang sudah jalan).
--  - live_chat_messages: pesan buyer <-> admin di dalam satu chat.
--  - push_subscriptions: langganan Web Push perangkat admin (endpoint +
--    kunci enkripsi dari Push API browser). Hanya admin yang boleh
--    tulis/baca; Edge Function send-push membacanya via service_role.
--  - push_settings: kunci VAPID (public + private) — HANYA service_role
--    yang bisa akses (tidak ada policy untuk anon/authenticated). Private
--    key dibuat oleh Edge Function setup-push-keys, TIDAK PERNAH tampil
--    di chat, file, atau memory.
-- Terapkan via SQL Editor Supabase (project GankStore).

-- ---------------------------------------------------------------------
-- 1. live_chats
-- ---------------------------------------------------------------------
create table if not exists public.live_chats (
  id uuid primary key default gen_random_uuid(),
  buyer_name text,
  buyer_contact text,
  status text not null default 'open',
  last_message text,
  last_sender text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. live_chat_messages
-- ---------------------------------------------------------------------
create table if not exists public.live_chat_messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.live_chats(id) on delete cascade,
  sender text not null check (sender in ('buyer', 'admin')),
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists live_chat_messages_chat_idx
  on public.live_chat_messages (chat_id, created_at);

-- ---------------------------------------------------------------------
-- 3. push_subscriptions + push_settings
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  label text,
  created_at timestamptz not null default now()
);

create table if not exists public.push_settings (
  id int primary key default 1,
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Trigger: tiap pesan baru -> perbarui last_message + updated_at chat
-- ---------------------------------------------------------------------
create or replace function public.touch_live_chat()
returns trigger
language plpgsql
as $$
begin
  update public.live_chats
     set last_message = left(new.text, 200),
         last_sender = new.sender,
         updated_at = now()
   where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists live_chat_messages_touch on public.live_chat_messages;
create trigger live_chat_messages_touch
  after insert on public.live_chat_messages
  for each row execute function public.touch_live_chat();

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table public.live_chats enable row level security;
alter table public.live_chat_messages enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_settings enable row level security;

-- live_chats: pembeli (anon) boleh buat + baca chatnya (UUID tidak bisa
-- ditebak); admin boleh semua.
create policy "live_chats_insert_public"
  on public.live_chats for insert
  with check (true);
create policy "live_chats_select_public"
  on public.live_chats for select
  using (true);
create policy "live_chats_all_admin"
  on public.live_chats for all
  using (public.is_admin())
  with check (public.is_admin());

-- live_chat_messages: pembeli hanya boleh kirim sebagai 'buyer';
-- baca bebas (UUID chat tidak bisa ditebak); admin boleh semua.
create policy "live_chat_messages_insert_buyer"
  on public.live_chat_messages for insert
  with check (sender = 'buyer');
create policy "live_chat_messages_select_public"
  on public.live_chat_messages for select
  using (true);
create policy "live_chat_messages_all_admin"
  on public.live_chat_messages for all
  using (public.is_admin())
  with check (public.is_admin());

-- push_subscriptions: hanya admin (yang login) yang boleh
-- simpan/lihat/hapus langganan perangkatnya.
create policy "push_subscriptions_all_admin"
  on public.push_subscriptions for all
  using (public.is_admin())
  with check (public.is_admin());

-- push_settings: TIDAK ADA policy untuk anon/authenticated -> hanya
-- service_role (Edge Function) yang bisa baca/tulis.

-- ---------------------------------------------------------------------
-- 6. Grants (pola sama seperti 02_rls.sql)
-- ---------------------------------------------------------------------
revoke all on public.live_chats from anon, authenticated;
grant insert, select on public.live_chats to anon, authenticated;
grant all on public.live_chats to authenticated;

revoke all on public.live_chat_messages from anon, authenticated;
grant insert, select on public.live_chat_messages to anon, authenticated;
grant all on public.live_chat_messages to authenticated;

revoke all on public.push_subscriptions from anon, authenticated;
grant all on public.push_subscriptions to authenticated;

revoke all on public.push_settings from anon, authenticated;
