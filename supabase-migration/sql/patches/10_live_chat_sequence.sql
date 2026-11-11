-- GankStore — patch 10: izin sequence untuk live_chat_messages.
-- Akar masalah (ditemukan 12 Nov 2026 ~01:05 WIB, tes REST anon):
--  1. Migrasi 09 memakai upsert untuk membuat chat — PostgREST butuh
--     hak UPDATE untuk upsert, dan anon tidak punya. Sudah diperbaiki di
--     sisi klien (supabase-client.js createChat: INSERT biasa + abaikan
--     error duplicate key), jadi patch ini TIDAK memberi hak UPDATE.
--  2. Sequence live_chat_messages_id_seq dibuat migrasi 09 SETELAH
--     grant blanket "on all sequences" di 02_rls.sql (6 Nov) jalan —
--     grant itu tidak berlaku surut ke sequence baru. Tanpa grant ini,
--     INSERT pesan oleh anon gagal "permission denied for sequence".
-- Terapkan via SQL Editor Supabase (project GankStore).

grant usage, select on sequence public.live_chat_messages_id_seq to anon, authenticated;

-- Jalankan ulang blanket grant supaya tabel/sequence yang dibuat migrasi
-- berikutnya tidak kena masalah yang sama.
grant usage, select on all sequences in schema public to anon, authenticated;
