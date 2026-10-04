# 17: Platform Fee configuration and ledger posting

**What to build:** The platform starts earning. An Admin sets the fee, a Donor sees it before paying, and every settled Donation posts it to the ledger, where today the account exists and is never written to.

**Blocked by:** 9

**Status:** done (PR #33, 397ebdc)

- [x] Fee resolves per Campaign, then per Category, then per Kind default
- [x] Waived below an Admin-set threshold, so a small gift carries only the Provider Fee
- [x] Rounded down, so the remainder falls to the Campaign and never to the platform
- [x] Posted to the Platform Fee ledger account on Settlement, with entries balanced
- [x] Changes apply only to Donations made afterwards; every change records who and when
- [x] The rate in force is shown on the Campaign page

## Comments

- 2026-10-04 (sapu checkbox, percepatan-full-rilis Track D): semua kotak dicentang setelah dicek di kode. `resolvePlatformFeeBasis` memakai urutan Campaign, Category, Kind (`src/lib/money/platform-fee-config.ts`); `computePlatformFee` membebaskan di bawah ambang dan `floorFeeShare` membulatkan ke bawah (`platform-fee.ts`); jurnal settlement mengkredit `PLATFORM_FEE` (`ledger.ts`); `PlatformFeeRule` dan `PlatformFeeThreshold` append-only dengan `setById` dan `setAt`, dan fee dibekukan pada Payment saat dibuat (`donation-charge.ts`); `CampaignDetailView` menampilkan `formatFeePercent`.
