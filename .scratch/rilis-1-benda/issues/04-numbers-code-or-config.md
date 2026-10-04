# 04: Are the PRD's numbers defaults in code, or configuration?

**Type:** grilling

**Status:** resolved

**Built by:** [88: A-1 admin-platform-fee-page](88-admin-platform-fee-page.md) (halaman Admin `platform-fee`) dan [87: P2 checkout-fee-hold-disclosure](87-checkout-fee-hold-disclosure.md) (fee % dan Escrow Hold di Checkout); keduanya ditulis builder di branchnya sendiri, belum ada di branch ini

## Question

The PRD states numbers in prose — Platform Fee waived below Rp50.000,
duplicate-hint similarity 0.6, Escrow Hold seven days, extra review above Rp100
million. Today those numbers live in four different places and **none of
them agree about who owns them**:

- `DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD` and `ESCROW_HOLD_DAYS` are code
  constants. FFI-07 says the Escrow Hold is set "from the Admin dashboard";
  FFI-05 says the 0.6 threshold is "set by an Admin".
- The fee thresholds are **rows**, append-only, set by an Admin — and
  **none have ever been set**, because there is no Admin page for them, only
  a POST route.

So the platform's money rules right now are: no fee at all, because no rate
exists; a 0.6 and a 7 days that an Admin cannot change.

Questions:

1. **Which of these does an Admin change, and which are fixed by the
   product?** Answering this changes what the missing Admin screens are even
   for — `/api/admin/platform-fee`, `/api/admin/duplicate-similarity` and
   `/api/admin/abuse-thresholds` all exist as routes with no page behind them,
   and building all three assumes the answer is "all three".

2. **What happens to money already frozen under the old number?** FFI-01
   freezes the fee and the Escrow Hold length onto the Payment at creation, so
   a change only affects later Donations. Is that right, or does a change
   need to reach Payments that have not settled? A Donor was shown a number;
   which one did the platform owe them?

3. **The Rp50.000 waiver is in no code at all.** It is not a code default and
   not an Admin row — it does not exist. Either it becomes one of the two, or
   it is dropped, and the PRD should stop saying it.

4. **What does the Donor see before paying?** FFI-01 says the fee and the
   Escrow Hold are "displayed before the Donor pays". Today the Campaign page
   shows a *percentage* and the Checkout shows neither. If the numbers are
   Admin-configurable, the Donor is being shown a promise that a config change
   can alter, and which number is the promise is a decision.

## Answer

Owner (Dri), 2026-09-28, in the batch grilling round
([grilling-borongan-2026-09-28.md](../grilling-borongan-2026-09-28.md)),
answered "ya semua": the recommendation stands as the decision.

Escrow Hold & threshold similarity tetap konstanta kode (jarang berubah,
tak sepadan 2 halaman Admin sebelum Fase 2); Platform Fee tetap konfigurasi
(mekanisme sudah ada, PRD minta override per Category/Campaign) — halaman
Admin `platform-fee` diprioritaskan, dua lainnya ditunda ke Fase 3; freeze-at-
creation yang berjalan sekarang dipertahankan; waiver jadi baris Admin (pakai
mekanisme `PlatformFeeThreshold` yang ada); Checkout wajib tampilkan fee % dan
lama Escrow Hold sebelum bayar — gerbang FFI-01 yang belum terpenuhi, murah
ditutup begitu (1) diputuskan.
