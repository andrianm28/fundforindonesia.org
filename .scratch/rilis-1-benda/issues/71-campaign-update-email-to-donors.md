# 71: N-2 campaign-update-email-to-donors

**Status:** ready-for-agent

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
