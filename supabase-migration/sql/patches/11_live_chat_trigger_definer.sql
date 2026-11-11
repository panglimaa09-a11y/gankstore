-- GankStore — patch 11: trigger touch_live_chat() harus SECURITY DEFINER.
-- Akar masalah (ditemukan 12 Nov 2026 ~01:07 WIB, tes REST anon):
-- INSERT pesan buyer gagal 42501 "permission denied for table
-- live_chats" — BUKAN karena insert pesannya, tapi karena TRIGGER
-- touch_live_chat() menjalankan UPDATE live_chats sebagai pemanggil
-- (anon), dan anon tidak punya hak UPDATE. Pola proyek (03_functions):
-- fungsi pemelihara seperti ini WAJIB security definer + search_path
-- public, supaya jalan sebagai pemilik fungsi.
-- Terapkan via SQL Editor Supabase (project GankStore).

create or replace function public.touch_live_chat()
returns trigger
language plpgsql
security definer
set search_path = public
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
