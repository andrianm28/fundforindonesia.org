# 04: Seberapa patuh proyek ini terhadap workflow Matt skills sejak diadopsi?

**Type:** research

**Status:** open

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

**Findings:** branch research/prd-audit-04, file .scratch/prd-audit/research/04-workflow.md
