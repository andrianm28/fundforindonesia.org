# Menjalankan aplikasi di dalam thread (cloud session)

Agar sebuah thread bisa mengklik perubahan di aplikasi sungguhan tanpa
menyentuh staging atau produksi, jalankan:

```sh
scripts/dev-thread.sh            # Postgres lokal, migrate, seed sekali, next dev di :3000
scripts/dev-thread.sh --reset    # hapus DB lokal dulu (seed ulang dari nol)
scripts/dev-thread.sh --stop     # hentikan next dev dan Postgres
eval "$(scripts/dev-thread.sh --env)"   # env yang sama untuk perintah lain (prisma studio, tsx, playwright)
```

Hasilnya `http://localhost:3000` dengan data demo `prisma/seed.ts`. Semua akun
seed bersandi `password123`:

| Akun | Peran |
| --- | --- |
| `admin@fundforindonesia.test` | Admin + Verifier |
| `moderator@fundforindonesia.test` | Verifier |
| `ahmad.fauzi@fundforindonesia.test` (dan 4 lainnya) | Fundraiser |
| `donor@fundforindonesia.test` | Donor |

- Pembayaran memakai provider `mock` (hanya diizinkan di luar
  `NODE_ENV=production`); email memakai mailer `mock` (dicatat, tidak
  terkirim). Tidak ada kredensial asli, semua nilai adalah placeholder seperti
  di CI.
- Butuh Postgres dan Node 24 dari setup script environment
  (`cloud-environment.md`); skrip memakai `/opt/node24` bila ada.
- Log server: `/tmp/ffi-dev-thread/next.log`.
- Screenshot: Playwright sudah terpasang di cloud session
  (`require('playwright')`, `chromium.launch()`), arahkan ke
  `http://localhost:3000`.
- Untuk e2e terhadap bundle produksi, ikuti job `e2e` di `.github/workflows/ci.yml`
  (`next build` lalu `npm run test:e2e`); dev server ini cukup untuk
  pemeriksaan manual.
- Jangan jalankan full suite (`npx vitest run`) bersamaan dengan
  `next dev` yang sedang mengompilasi bila CPU sempit (lihat `AGENTS.md`).
