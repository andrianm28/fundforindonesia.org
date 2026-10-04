# 31: Refund at Gross with a refund-cost account

**What to build:** The ledger can return to a Donor exactly what they paid, with the unrecoverable Provider Fee booked as a platform cost instead of being taken from the Donor.

**Blocked by:** 17

**Status:** done
PR #132, migration add_refund_ledger_accounts

- [x] A refund-cost ledger account exists
- [x] The cap rises from Net to Gross; the existing Net cap and the comment defending it are corrected
- [x] A covered refund posts four balanced legs, the three debits totalling exactly Gross
- [x] A partial refund returns fees proportionally, rounded so the pair never exceeds the refunded amount, with the frozen leg taking the remainder and never going negative
- [x] Where Campaign funds no longer cover it, the shortfall including its fee share is booked to refund cost and the Campaign Balance never goes negative
- [x] Implements ADR 0007, which the current code contradicts

## Comments

- 2026-10-04 (sapu checkbox, Track D): semua kotak dicentang setelah dicek di kode. Akun `REFUND_COST` ada di skema; `createRefund` membatasi kumulatif terhadap `payment.amount` (Gross); `refundRequestedLegs` memposting satu kredit `FROZEN_BALANCE` dan tiga debit (Net, `PLATFORM_FEE`, `REFUND_COST`) yang berjumlah tepat Gross; porsi fee proporsional lewat `feePortionOf` (kumulatif, tak pernah negatif, dan `refundRequestedLegs` menolak bila dua porsi melebihi jumlah Refund); shortfall dibukukan ke `REFUND_COST` saat approve; kode merujuk ADR 0007. Tes: `ledger.test.ts` dan `refunds.test.ts`.
