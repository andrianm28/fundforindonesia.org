# 21: Upgrade framer-motion 12 to 13 (Dependabot #14)

**What to build:** `framer-motion` ^12.42.2 is used in about 19 files under
`src/`. Upgrade to 13 (checking its changelog for renamed APIs and the `motion`
package split), fix any breaking usage, and close Dependabot PR #14 in favour
of this one.

**Blocked by:** 15 (React 19 comes with the Next 16 upgrade; framer-motion 13 targets it)

**Status:** awaiting-merge

- [x] `framer-motion` 13.x (or the successor package the changelog names), one copy in `npm ls`
- [x] Every animated component still renders; the tests that mount them pass
- [ ] CI green; Dependabot #14 is closed with a pointer to this PR

## Comments

- 2026-10-02: awaiting-merge. PR #168, commit 7eaf859. Status sudah benar; catatan ditambahkan koordinator.

- 2026-10-02: Diverifikasi di npm registry: `framer-motion` 13.0.0 (2026-08-05)
sampai 13.5.0 (`latest`) ada dan stabil; nama paket tidak berganti (`motion`
hanya paket paralel dengan versi sama). Peer dep `react ^18 || ^19`.
Satu-satunya breaking change 13.0.0: `@emotion/is-prop-valid` opsional dihapus,
diganti `<MotionConfig isValidProp>`; repo tidak memakainya, jadi tidak ada
perubahan kode. Upgrade ke ^13.5.0 (lockfile via `npm install`, satu salinan di
`npm ls`). Tes komponen 45 file/514 lulus, ratchet lint 193 / tsc 47 tetap,
`next build` sukses. Repo tidak memakai `useReducedMotion`/`MotionConfig`, jadi
perilaku reduced-motion tidak berubah; tindak lanjut terpisah bila diinginkan.
Branch `claude/ci-cd-21-framer-motion`, PR belum dibuka. Dependabot #14 ditutup
setelah PR ini merge.
