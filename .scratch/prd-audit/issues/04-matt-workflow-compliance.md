# 04: Seberapa patuh proyek ini terhadap workflow Matt skills sejak diadopsi?

**Type:** research

**Status:** resolved

**Findings:** `.scratch/prd-audit/research/04-workflow.md`

**Blocked by:** —

## Question

Sejak 2026-09-26 (adopsi `/setup-matt-pocock-skills`), ukur terhadap `CLAUDE.md`,
`AGENTS.md`, dan `docs/agents/*.md`:

- **Artefak (penuh):** setiap fitur yang merge punya `spec.md` dan tiket di
  `.scratch/`; baris `Status:` sesuai kenyataan (tiket `open`/`in-review` yang
  kodenya sudah merge, atau `done` yang PR-nya belum merge); `Blocked by`
  dihormati; peta wayfinder mengikuti `docs/agents/issue-tracker.md`.
- **Kebersihan dokumen (penuh):** `CONTEXT.md` murni glosarium; format ADR;
  `CLAUDE.md`/`AGENTS.md`/handoff tidak saling bertentangan (mis. batas agent 4
  vs 8); salinan vendored `.claude/skills/` vs plugin dan `.claude/settings.json`.
- **Proses (sampel 10 PR uang terakhir):** tes masuk bersama kodenya, review
  independen tercatat untuk kode uang, tidak ada merge dengan CI merah.

Keluaran ke `.scratch/prd-audit/research/04-workflow.md` di branch
`research/prd-audit-04`: temuan berperingkat, masing-masing dengan bukti.

## Answer

Enam temuan berperingkat. Dua HIGH: (1) tidak satu pun dari 10 PR uang
terakhir punya review independen yang tercatat di GitHub (`get_reviews`
kosong di semuanya) — lihat nuansa koordinator di bawah; (2) tiket
`prd-compliance-fase-0-2/issues/35` mengklaim `done (PR #93, ...)` padahal
PR #93 tidak pernah merge — fiturnya mendarat lewat PR #108 yang berbeda.
Tiga MEDIUM/LOW: `AGENTS.md` vs `handoff-map.md` sempat berbeda soal batas
agent background (4 vs 8, kini sudah diselaraskan di `AGENTS.md` versi
terbaru); `CONTEXT.md` sempat menaruh path/identifier kode di tiga entri,
melanggar prinsip glosarium; beberapa commit uang mendarat tanpa bentuk
"Merge pull request" standar GitHub (kemungkinan rebase/fast-forward push),
konsisten dengan branch protection yang belum terpasang (tiket 10). Satu
INFO: salinan vendored `.claude/skills/` belum dihapus, sesuai desain
sampai plugin terbukti termuat di cloud session baru.

**Nuansa koordinator pada temuan 1:** untuk PR #121, review independen
Standards + Spec dan re-review-nya **memang dijalankan**, sebagai subagent
yang di-dispatch koordinator — bukan dilewati. Celahnya bukan "review
dilewati", melainkan **hasil review itu tidak pernah diposting ke PR**
sebagai GitHub review/comment, jadi tidak ada jejak audit yang bisa dibaca
ulang siapa pun selain lewat percakapan sesi koordinator. Perbaikannya tetap
seperti direkomendasikan riset: wajibkan hasil reviewer independen diposkan
sebagai `pull_request_review_write`/`add_issue_comment` yang sesungguhnya,
bukan hanya dirangkum ke pesan commit penulis.

Pointer: `.scratch/prd-audit/research/04-workflow.md`.
