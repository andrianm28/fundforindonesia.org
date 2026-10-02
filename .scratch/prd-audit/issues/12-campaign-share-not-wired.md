# 12: Tombol Bagikan di halaman Campaign tidak tersambung ke ShareModal (FFI-06)

**Type:** task

**Status:** done (PR #165, c31d703)

**Blocked by:** —

## Why

Ditemukan di tiket 09. PRD FFI-06 (`docs/PRD-fund-for-indonesia.md:123`,
Fase 1): tombol bagikan WhatsApp, Facebook, X, salin tautan, Traffic Source
per tautan lewat parameter sumber, gambar pratinjau dari sampul.
`ShareModal` (`src/components/shared/ShareModal.tsx`) sudah memuat empat
kanal dan `?src=`, tapi tidak diimpor halaman mana pun; halaman Campaign
nyata (`CampaignDetailView.tsx:254-258`) punya tombol "Bagikan" berkomentar
"placeholder" tanpa `onClick`. `CampaignDetail` dan `CampaignCTA` juga yatim.
`CONTEXT.md:83` menyatakan tidak ada klausa PRD yang meminta berbagi; itu
bertentangan dengan FFI-06.

## Question

(1) Sambungkan `ShareModal` ke tombol di `CampaignDetailView` (dan
pertimbangkan menyamakan layar sukses donasi, `donate/page.tsx:461-500`,
yang tanpa X dan `?src=`), atau (2) owner memutuskan FFI-06 tidak masuk
Rilis 1 dan PRD direvisi? Apa pun jawabannya, koreksi kalimat di
`CONTEXT.md:83`. Periksa juga apakah gambar pratinjau (Open Graph dari
sampul) ada di halaman Campaign.

## Comments

- 2026-10-02: option (1) done on `claude/prd-audit-12-campaign-share`.
  - The "Bagikan" button in `CampaignDetailView` opens `ShareModal`.
  - `ShareModal` builds URLs with `publicUrl()` (canonical domain, no longer `window.location.origin`), encodes the slug, and opens external targets with `noopener,noreferrer`.
  - The `CONTEXT.md` Fundraiser line now cites FFI-06.
  - Not done: the donate success screen (`donate/page.tsx`) still lacks X and `?src=`; orphaned `CampaignDetail` and `CampaignCTA` are kept.
  - Open Graph from the cover already exists in `generateMetadata` (`src/app/campaign/[slug]/page.tsx`).
- 2026-10-02: done. Merged di PR #165 (c31d703). Status sebelumnya `in-review` (label tidak sah); dikoreksi koordinator.
