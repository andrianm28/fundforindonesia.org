# 06: Temuan workflow mana yang diperbaiki, dan bagaimana?

**Type:** grilling

**Status:** resolved

**Blocked by:** 04

## Question

Dari temuan tiket 04: mana yang dibereskan sekarang (status tiket, dokumen yang
saling bertentangan), mana yang menjadi aturan baru di `AGENTS.md` atau
`docs/agents/`, dan mana yang diterima apa adanya dengan alasan tertulis?

## Answer

Owner (Dri) menjawab "ya semua triase" 2026-09-28, satu pesan untuk seluruh
ronde -- rekomendasi di
[`triage-2026-09-28.md`](../triage-2026-09-28.md) Bagian B adalah keputusan,
Q1–Q6. Diresolve bersama tiket 05 karena keduanya dijawab dalam pesan yang
sama.

- **Q1** [HIGH] review independen tak diposting ke PR: **new-rule** -- aturan
  baru di `AGENTS.md` Review, hasil reviewer independen wajib jadi
  `pull_request_review_write`/`add_issue_comment` sungguhan sebelum merge.
- **Q2** [HIGH] tiket 35 mengklaim PR #93 yang tak pernah merge: **fix-now** --
  `prd-compliance-fase-0-2/issues/35` diubah ke `done (PR #108, a1889fe)`.
- **Q3** [MEDIUM] `AGENTS.md` vs `handoff-map.md` beda soal batas agent (4 vs
  8): **new-rule** -- `AGENTS.md` satu-satunya sumber aturan tiering/dispatch;
  angka batas di `handoff-map.md` tidak diulang lagi, digantikan pointer.
- **Q4** [MEDIUM] `CONTEXT.md` membawa path/identifier kode di tiga entri:
  **new-rule** -- pertahankan fakta "belum ada kodenya", hapus path/identifier
  spesifiknya.
- **Q5** [LOW] commit uang mendarat tanpa "Merge pull request" standar:
  **accept, tracked** -- gejala carry-trap yang sudah dikenal dan tiket
  `ci-cd-github-actions/issues/10` yang masih terbuka; tidak perlu tiket baru.
- **Q6** [INFO] salinan vendored `.claude/skills/` belum dihapus: **accept**
  (owner-gated) -- tunggu owner mengonfirmasi plugin termuat di cloud session
  baru.
