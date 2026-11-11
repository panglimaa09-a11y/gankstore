-- Patch 08 — bukti pembayaran di invoice (upload foto wajib sebelum kirim WA).
-- 1) kolom baru di orders, 2) RPC submit_payment_proof (security definer).
-- Jalankan di Supabase SQL Editor (project GankStore) setelah patch 07.
-- Foto disimpan sebagai data-URI JPEG hasil kompres (maks ~200 KB) di proof_image.
alter table public.orders add column if not exists proof_image text;
alter table public.orders add column if not exists proof_at timestamptz;

create or replace function public.submit_payment_proof(p_invoice text, p_proof_image text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where invoice_no = p_invoice;
  if not found then
    raise exception 'Invoice tidak ditemukan';
  end if;
  -- Pemilik pesanan boleh mengunggah; pesanan tamu (buyer_id null) bebas
  -- karena pembeli tamu tidak punya akun — invoice-nya sendiri yang jadi kunci.
  if v_order.buyer_id is not null and auth.uid() is distinct from v_order.buyer_id then
    raise exception 'Bukan pesananmu';
  end if;
  if v_order.status <> 'dipesan' then
    raise exception 'Pesanan sudah %', v_order.status;
  end if;
  if p_proof_image is null or length(p_proof_image) < 100 or length(p_proof_image) > 500000 then
    raise exception 'Foto bukti wajib diunggah (gambar JPG hasil kompres)';
  end if;
  update public.orders
  set proof_image = p_proof_image, proof_at = now()
  where invoice_no = p_invoice;
  perform public.log_activity(
    'pesan',
    'Bukti pembayaran diterima — invoice ' || p_invoice || ' (' || v_order.title || '). Menunggu konfirmasi admin.'
  );
  return jsonb_build_object('ok', true, 'invoice_no', p_invoice);
end;
$$;

grant execute on function public.submit_payment_proof(text, text) to anon, authenticated;
