# 71: N-2 campaign-update-email-to-donors

**Status:** awaiting-merge (belum done: opt-out menunggu keputusan owner)

**Blocked by:** 70 (F1)

**Ukuran:** M

**Catatan:** Review privasi: email donor tamu dienkripsi, kirim hanya lewat dekripsi terkendali. Tanpa skema.

## Latar

Donor yang pernah berdonasi seharusnya menerima kabar baru Campaign. Email donor tamu tersimpan terenkripsi, jadi pengiriman butuh dekripsi dan perhatian privasi (UU PDP).

## Berkas relevan

- `src/lib/contact-fields.ts` (pembaca plaintext) dan `src/lib/contact-plaintext-readers.test.ts` (guard)
- `src/lib/mail/index.ts`
- `src/lib/donor-anonymisation.ts`
- `src/lib/scheduled-jobs.ts` (bila dikirim lewat job)

## Acceptance

- [ ] Donor yang berdonasi (terdaftar maupun tamu) menerima email saat kabar baru terbit, tanpa duplikasi
- [ ] Dekripsi email tamu hanya lewat pembaca yang disetujui guard; guard tetap hijau
- [ ] Donor dapat berhenti menerima email dan pilihan itu dihormati
- [ ] Email tidak membocorkan daftar penerima lain; donasi anonim tetap anonim
- [ ] Review privasi dilakukan reviewer independen dan hasilnya diposting di PR

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
- 2026-10-30: email ke Donor (confirmed, non-sandbox, dedupe per alamat via HMAC, anonim tetap menerima tanpa nama) dikirim best-effort setelah POST kabar. BELUM: berhenti berlangganan (butuh model skema penyimpanan opt-out; slot skema belum ada) dan review privasi independen di PR.
- 2026-10-30: perbaikan dari review privasi PR 304: (P1, arah rekomendasi, belum final) email hanya ke Donor terdaftar, tamu dikecualikan lewat konstanta `NOTIFY_GUEST_DONORS` di `campaign-update-notify.ts`, dan email memuat alasan penerimaan; (P2) hanya kabar pertama per Campaign dalam 24 jam yang diemail; (P3) circuit breaker setelah 5 kegagalan kirim berturut-turut, satu baris log tanpa alamat; (P4) status Campaign dicek ulang (`isPubliclyViewable`) sebelum kirim, model User tidak punya penanda suspend/hapus jadi tidak ada filter akun; (NIT) donasi anonim menang atas bernama. OPT-OUT MASIH MENUNGGU KEPUTUSAN OWNER (butuh skema); tiket belum done.
- 2026-10-30: re-review PR 304: batas frekuensi kini satu email per Campaign per tanggal kalender WIB (jendela 24 jam bergulir salah); hanya status ACTIVE/COMPLETED/EXPIRED yang diemail, dicek ulang tiap 50 penerima; log error SMTP disaring dari alamat. TINDAK LANJUT: pengiriman tidak bisa dilanjutkan setelah abort/restart karena tidak ada catatan terkirim (butuh skema, mis. penanda terkirim per kabar/penerima); tanpa jeda antar kirim; dedupe belum membandingkan `emailHmacKeyId`.
- 2026-10-30: batas frekuensi diterima apa adanya: paling banyak satu email per Campaign per tanggal WIB. Pengiriman yang berhenti karena status Campaign berubah mencatat satu baris `campaign_update_notify_stopped` (id, status, jumlah terkirim; tanpa alamat).
