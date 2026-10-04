# 66: F3 verifier-flag-admin-urgent

**Status:** ready-for-agent

**Blocked by:** none (backend `flagCampaign`, `dismissFlag`, `setUrgent` sudah ada)

**Ukuran:** M

**Catatan:** Layar; tanpa skema. Terkait C10 (Admin menangguhkan tanpa Flag) tetapi tidak bergantung padanya.

## Latar

Verifier tidak punya form untuk memasang Flag dan Admin tidak punya tombol dismiss atau toggle Urgent, padahal route-nya ada.

## Berkas relevan

- `src/lib/campaign-lifecycle.ts` (`flagCampaign` ~1761, `dismissFlag` ~1796, `setUrgent` ~1602)
- `src/app/api/campaigns/[slug]/flags/route.ts`
- `src/app/api/campaigns/[slug]/flags/[id]/dismiss/route.ts`
- `src/app/api/campaigns/[slug]/urgent/route.ts`
- `src/app/moderasi/campaigns/[id]/page.tsx`
- `src/app/admin/campaigns/lifecycle/[slug]/page.tsx` dan `src/components/admin/AdminCampaignLifecycleActions.tsx`

## Acceptance

- [ ] Verifier memasang Flag dengan alasan dari layar moderasi Campaign
- [ ] Admin melihat Flag aktif dan menolaknya (dismiss) dengan catatan
- [ ] Admin menyalakan dan mematikan Urgent dari layar lifecycle
- [ ] Aturan aktor dan galat domain dari backend ditampilkan, bukan diduplikasi di UI
- [ ] Tes komponen dan satu e2e untuk alur Flag lalu dismiss

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C10 dijawab owner sesuai rekomendasi: Admin boleh menangguhkan Campaign tanpa Flag dari Verifier, asal alasannya tercatat. Itu sudah perilaku `CONTEXT.md` (Suspension) dan ADR 0015, jadi tiket ini tidak berubah dan tetap tidak bergantung padanya; layar Flag tidak boleh menjadikan Flag prasyarat Suspension.
