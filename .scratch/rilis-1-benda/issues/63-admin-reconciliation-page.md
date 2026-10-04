# 63: A-2 admin-reconciliation-page

**Status:** ready-for-agent

**Blocked by:** none (API `/api/admin/reconcile` dan `/api/admin/provider-withdrawals` sudah ada)

**Ukuran:** L

**Catatan:** Layar Admin; tanpa skema. Menyangkut uang (rekonsiliasi), jadi review independen disarankan.

## Latar

Gerbang F2 menuntut rekonsiliasi dari layar Admin tanpa psql. Backend `reconcileProviderBalances` dan route-nya sudah ada, tetapi tidak ada halaman: Admin hanya bisa memanggil API. Webhook yang butuh peninjauan (`WebhookEvent` needs-review) juga belum punya antrean.

## Berkas relevan

- `src/app/api/admin/reconcile/route.ts`
- `src/app/api/admin/provider-withdrawals/route.ts`
- `src/lib/money/provider-withdrawals.ts` (`reconcileProviderBalances`, `recordProviderWithdrawal`)
- `src/lib/money/payment-reconciliation.ts`
- `docs/runbooks/payment-reconciliation.md` (diperbarui)
- `src/components/admin/AdminSidebar.tsx` (satu baris; merge berurutan)
- halaman baru `src/app/admin/reconciliation/page.tsx`

## Acceptance

- [ ] `/admin/reconciliation` menampilkan laporan `/api/admin/reconcile` per penyedia dan menandai selisih
- [ ] Form pencatatan provider-withdrawal di halaman yang sama memakai route yang ada, dengan pesan galat yang bisa dibaca
- [ ] Antrean webhook needs-review tampil, dengan penyedia, jenis, dan waktu
- [ ] Halaman hanya terbuka untuk assignment ADMIN; pengunjung lain mendapat 404 seperti halaman Admin lain
- [ ] Tes komponen/halaman dan satu e2e di `tests/e2e/`
- [ ] `docs/runbooks/payment-reconciliation.md` diperbarui memakai layar ini, bukan panggilan API

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
