# 18: Promote the new eslint-config-next 16 rules from warn to error

**What to build:** Ticket 15's Next 16 upgrade brought in four ESLint rules
that the old `.eslintrc.json` never enforced at all:
`react-hooks/set-state-in-effect`, `react-hooks/immutability` and
`react-hooks/purity` (all from `react-hooks@7`'s React Compiler-oriented rule
set), plus a stricter default for `@next/next/no-html-link-for-pages`. Ticket
15 set all four to `warn` in `eslint.config.mjs` rather than either dropping
them or leaving them as blocking errors mid-upgrade (they currently fire on a
handful of files: 10 `set-state-in-effect`, 2 `immutability`, 2 `purity`, 1
`no-html-link-for-pages`).

Fix the flagged spots, then promote each rule back to `'error'` in
`eslint.config.mjs`, and lower `ci/baselines.json`'s `lint` count once
`eslint . --format json` reports fewer errors after the fix (it will only go
lower here, since the rules were `warn` and not counted before).

**Blocked by:** 15 (must merge first; this ticket's baseline math depends on
ticket 15's `eslint.config.mjs` and `ci/baselines.json`)

**Status:** done (PR #196, 65fca94)

- [ ] All four rules read `'error'` in `eslint.config.mjs`, not `'warn'` (dua dari empat; sisanya dipindah ke 18b)
- [ ] `eslint .` reports zero findings for these four rules
- [ ] `ci/baselines.json`'s `lint` count reflects the new, lower total (never raised)
- [ ] CI is green: test, build, migrations, ratchet

## Comments

- 2026-10-03, branch `claude/ci-cd-18-lint-rule-upgrade-v2` (dari `origin/main`; branch lama
  `claude/ci-cd-18-lint-rule-upgrade` tidak dipakai karena menaikkan baseline lint 193 ke 211 dan menambah
  bypass `RATCHET_ALLOW_BASELINE_BUMP` di `ci.yml`). Keputusan owner "setuju semua":
  - Hanya tiga perbaikan mekanis diambil: `Link` di `moderasi/campaigns/[id]`, `connectSSE` bernama di
    `usePrayerStream`, dan `fetchBalance` di `akun/page.tsx`. Pemindahan `fetchBalance` seperti di branch lama
    mengganti satu temuan `immutability` dengan satu temuan `set-state-in-effect` baru, jadi tidak diambil;
    fetch-nya di-inline di effect tanpa `setBalanceLoading(true)` sinkron (state awalnya sudah `true`), yang
    menghapus kedua temuan.
  - Dinaikkan ke `error`: `react-hooks/immutability` dan `@next/next/no-html-link-for-pages` (nol temuan).
    `react-hooks/set-state-in-effect` dan `react-hooks/purity` tetap `warn`.
  - Baseline lint tetap 193 (jumlah error memang 193; aturan yang dinaikkan sudah bersih). `ci.yml` tidak disentuh.
  - Sisa pekerjaan (15 temuan `set-state-in-effect`, 2 `purity`, lalu promosi keduanya ke `error`) dipindah ke
    tiket 18b. Angka 16 di keputusan owner menghitung temuan `akun/page.tsx` yang kini sudah hilang.
- 2026-10-03: done. Merge ke main sebagai 65fca94.
