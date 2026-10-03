# 56: Flag untuk menampilkan Demo Campaign di katalog sebelum launch

**Status:** ready-for-agent

**Blocked by:** none

Keputusan owner 2026-10-03, setelah cutover produksi ke repo ini: situs tampak
kosong. Semua Campaign era kibi-clone berisi data fiktif dan sudah ditandai
`isDemo` oleh migrasi `20260917163016_mark_demo_campaigns`, sementara aturan
Demo Campaign (`CONTEXT.md`) mengecualikannya dari katalog, pencarian, sitemap,
dan Impact. Seed ulang tidak dipakai: `prisma/seed.ts` menolak database yang
sudah berisi Campaign dan membuat akun Admin dengan password yang diketahui
publik.

Owner memilih sebuah env flag, off secara default, yang selama masa sebelum
launch menampilkan Demo Campaign di katalog dengan lencananya.

- [ ] Env flag server-side (mis. `SHOW_DEMO_CAMPAIGNS`, aktif hanya bila
      bernilai persis `"true"`, pola yang sama dengan `NEXT_PUBLIC_DONATIONS_ENABLED`)
      membuat Demo Campaign ikut tampil di beranda, katalog/explore, dan
      pencarian; tanpa flag perilaku tidak berubah
- [ ] Demo Campaign yang tampil selalu membawa lencana Demo di kartu dan di
      halamannya
- [ ] Yang TIDAK berubah walau flag aktif: Donation dan Payout tetap ditolak,
      Impact dan semua hitungan uang/abuse/dormant tetap mengecualikannya,
      sitemap tetap tidak mencantumkannya
- [ ] Satu tempat yang memutuskan "tampil di katalog publik" dipakai semua
      pembaca katalog, bukan flag yang diperiksa di tiap halaman
- [ ] `.env.example` dan entri Demo Campaign di `CONTEXT.md` menyebut flag ini
- [ ] Tes untuk flag aktif dan tidak aktif

## Comments
