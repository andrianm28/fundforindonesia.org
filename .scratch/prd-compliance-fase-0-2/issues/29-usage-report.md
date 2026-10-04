# 29: Usage Report and next-Payout gating

**What to build:** Donors see what a disbursed Payout was spent on, and a Fundraiser cannot take more money until they have reported on the last.

**Blocked by:** 28

**Status:** done
PR #129

- [x] A report carries a narrative, line items summing exactly to the Payout amount, at least one photo and a beneficiary count
- [x] It appears publicly on the Campaign page as soon as it is submitted, without waiting for review
- [x] An Admin may mark it questioned; the marker and its reason are also public and block the next Payout
- [x] A missing report blocks the next Payout request

## Comments

- 2026-10-04 (sapu checkbox, Track D): semua kotak dicentang setelah dicek di kode. `submitUsageReport` memvalidasi narasi, minimal satu pos, jumlah pos sama dengan nominal Payout, minimal satu foto, dan jumlah penerima manfaat (`src/lib/usage-reports.ts`); `CampaignDetailView` menampilkan laporan tanpa tahap review, termasuk `disputedAt` dan `disputedReason`; `campaignBlockingUsageReport` menahan Payout berikutnya untuk laporan yang hilang atau dipertanyakan, dipanggil dari `payouts.ts`.
