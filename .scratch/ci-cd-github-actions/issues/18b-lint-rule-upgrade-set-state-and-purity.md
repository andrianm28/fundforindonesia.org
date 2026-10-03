# 18b: Fix set-state-in-effect and purity findings, then promote both rules to error

**What to build:** Sisa tiket 18. Setelah 18 menaikkan `react-hooks/immutability` dan
`@next/next/no-html-link-for-pages` ke `error`, dua aturan `react-hooks@7` masih `warn` di
`eslint.config.mjs` karena masih ada temuan: **15** `react-hooks/set-state-in-effect` dan **2**
`react-hooks/purity` (angka ini hasil `eslint . --format json` pada branch 18-v2; owner menyebut 16
karena sempat menghitung `akun/page.tsx`, yang sudah diperbaiki di 18). Perbaiki **per komponen**, bukan
dengan mematikan aturan atau memakai `eslint-disable`, lalu naikkan keduanya ke `'error'`.

Temuan saat ini:

- `react-hooks/set-state-in-effect` (15): `src/app/admin/partnership-inquiries/page.tsx`,
  `src/app/admin/users/page.tsx`, `src/app/admin/verification-checklist/page.tsx`,
  `src/app/akun/pengaturan/page.tsx`, `src/app/akun/rekening/BankAccountRegister.tsx`,
  `src/app/campaign/[slug]/not-found.tsx`, `src/app/donasi-saya/page.tsx`,
  `src/app/explore/all/page.tsx`,
  `src/app/moderasi/partner-organisations/PartnerOrganisationRegister.tsx`,
  `src/app/volunteer-trip/_components/HoldCountdown.tsx`, `src/components/admin/AdminSidebar.tsx`,
  `src/components/campaign/CampaignDetail.tsx` (2), `src/components/campaign/CampaignPayoutPanel.tsx`,
  `src/components/ui/ProgressBar.tsx`.
- `react-hooks/purity` (2): `src/app/moderasi/partner-organisations/PartnerOrganisationRegister.tsx`
  (dua `Date.now()` saat render, baris 272 dan 378).

Pendekatan: satu komponen satu commit, masing-masing dengan perilaku yang sama (state awal yang benar
alih-alih setState sinkron di effect, state turunan dihitung saat render, panggilan tidak murni dipindah ke
effect atau handler). Tes komponen yang ada harus tetap hijau; tambahkan tes bila perilakunya belum tertutup.

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] Setiap temuan `set-state-in-effect` dan `purity` diperbaiki per komponen, tanpa `eslint-disable`
- [ ] `eslint .` tidak melaporkan temuan untuk kedua aturan itu
- [ ] `react-hooks/set-state-in-effect` dan `react-hooks/purity` bernilai `'error'` di `eslint.config.mjs`
- [ ] `ci/baselines.json` `lint` tidak naik (turun bila memang turun); `ci.yml` tidak disentuh, tanpa bypass baseline
- [ ] CI hijau: test, build, migrations, ratchet

## Comments

- 2026-10-03: dibuat dari tiket 18 atas keputusan owner ("setuju semua"). Lihat Comments tiket 18.
