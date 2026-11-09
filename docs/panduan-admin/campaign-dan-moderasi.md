# Campaign dan moderasi

**Layar:** Moderasi > Kampanye (`/moderasi/campaigns`, detail `/moderasi/campaigns/[id]`); Admin > Kampanye (`/admin/campaigns`, 50 terbaru); Admin > Suspension & Cancellation (`/admin/campaigns/lifecycle`).
**Siapa:** Verifier meloloskan, menolak, dan memasang Flag. Admin menjatuhkan dan mencabut Suspension, menyetujui Cancellation, menandai Completed.

## Meninjau pengajuan (Verifier)

1. Buka **Kampanye** di panel Moderasi, pilih pengajuan (Verification Request) yang menunggu.
2. Baca isi, dokumen, dan **Petunjuk Duplikat** (kemiripan judul, dst.) yang tampil di detail.
3. Centang tiap butir checklist. **Loloskan** hanya aktif bila semua butir wajib tercentang. Untuk Campaign Fundraiser perorangan, konfirmasi Collecting Entity yang menaungi saat meloloskan.
4. **Tolak** wajib disertai alasan; Fundraiser boleh memperbaiki dan mengajukan lagi (riwayat penolakan tersimpan).
5. Dashboard Moderasi juga menghitung pengajuan Verifikasi Tambahan (dibuka sistem saat Gross melewati ambang; lihat [biaya-escrow-ambang.md](biaya-escrow-ambang.md)) dan antrean rekening.

## Flag, Suspension, Cancellation

1. **Flag** (Verifier): tombol **Pasang Flag** di detail Campaign, dengan alasan. Flag bukan pembekuan.
2. **Suspension** (Admin): di `/admin/campaigns/lifecycle`, kelompok Flag terbuka. Buka Campaign, isi **Alasan Suspension**. Berlaku juga untuk Campaign Expired dan Completed ([ADR 0015](../adr/0015-suspension-reaches-closed-campaigns.md)). Flag juga boleh ditolak Admin dengan alasan.
3. Efek Suspension: donasi berhenti, Escrow Hold dan saldo dibekukan, Payout ditolak, Refund bisa dimulai.
4. **Mencabut Suspension**: hanya Admin **yang bukan pelaku Suspension itu**; tombolnya tidak ditawarkan kepada pelaku. Isi alasan pencabutan. Campaign kembali ke status sebelumnya (atau langsung Expired bila tenggatnya sudah lewat).
5. **Cancellation**: permintaan Fundraiser muncul di kelompok ketiga; Admin memutuskan dengan alasan keputusan.

## Hal yang perlu diwaspadai

- Admin atau Verifier tidak bisa memutuskan Campaign miliknya sendiri; layar menjelaskan alasannya.
- Pada Campaign Active, hanya cerita dan sampul yang bisa diubah langsung; target, tenggat, atau rekening butuh pengajuan baru.
- Campaign tidak pernah dihapus ([ADR 0016](../adr/0016-campaigns-are-never-deleted.md)).
- Campaign Active tanpa Collecting Entity tidak menerima donasi; tetapkan di `/admin/collecting-entities` atau `/moderasi/collecting-entities`.
