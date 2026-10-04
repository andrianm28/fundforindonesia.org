# 04: H-5 glitchtip-error-monitoring

**Status:** ready-for-agent

**Blocked by:** none; DSN GlitchTip dari owner (A3) hanya untuk aktivasi, bukan untuk kode

**Ukuran:** M

**Catatan:** Observabilitas; tanpa skema. Tanpa DSN atau kredensial di repo.

## Latar

Belum ada pemantauan galat. GlitchTip kompatibel Sentry; PII tidak boleh ikut terkirim.

## Berkas relevan

- `src/lib/env-check.ts`
- `next.config.*`
- `src/app/layout.tsx`
- `.env.example` (koordinator)
- `package.json` (koordinator)

## Acceptance

- [ ] SDK Sentry-compatible aktif hanya bila DSN diset; tanpa DSN aplikasi berjalan normal
- [ ] `beforeSend` membuang PII: email, nomor rekening, token, header Authorization, dan isi body
- [ ] Tes untuk scrubber memakai contoh sintetis
- [ ] Galat server dan klien tertangkap; tes bahwa tanpa DSN tidak ada panggilan jaringan

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
