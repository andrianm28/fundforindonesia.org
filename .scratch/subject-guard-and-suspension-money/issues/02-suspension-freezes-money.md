# 02: Suspension freezes Payouts and Escrow release

**What to build:**
- A Payout is requested and approved only while its Campaign is effectively Active, Expired or Completed.
- Suspended and Cancelled refuse it (409, typed code, Indonesian message), even when the Suspension lands between request and approval.
- The Escrow release sweep leaves a Suspended Campaign's matured money in Escrow Hold and releases it on the first sweep after a lift.
- Refunds stay possible on a Suspended Campaign.
- Volunteer Trips behave exactly as today.

See the spec, section "Suspension effects", and CONTEXT.md (Payout, Escrow Hold).

**Blocked by:** 01

**Status:** done

- [x] `requestPayout` and `approvePayout` call `requirePayoutAllowed` inside the lock. A table test covers every Campaign effective status for both
- [x] A Suspension committed before approval's lock refuses the approval, and the Payout stays as it was
- [x] Escrow sweep: a Suspended Campaign's matured money stays in hold (no ledger legs); after a lift it is released; Trips are unaffected
- [x] `createRefund`/`approveRefund` still succeed on a Suspended Campaign
- [ ] Payout routes answer 409 with the typed code. Full suite green, tsc adds no errors

## Comments

- 2026-10-04 (sapu checkbox, Track D): empat kotak pertama dicentang setelah dicek di kode dan tes: `payouts.test.ts` (tabel `PAYOUT_BY_EFFECTIVE_STATUS` untuk request, approve, complete; Payout tetap `DRAFT` dan tanpa jurnal), `escrow.test.ts` (Campaign Suspended tertahan, dilepas setelah lift, Trip tetap dilepas), `refunds.test.ts` (Refund tetap bisa dibuat dan disetujui). Kotak 5 tidak dicentang: route memang menjawab 409 `PAYOUT_NOT_ALLOWED_FOR_STATUS` (`domain-errors.ts` dan tes route), tetapi bagian "full suite green, tsc adds no errors" adalah fakta CI yang tidak bisa dibuktikan dari kode.
