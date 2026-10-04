# 05: The reconcile report explains Escrow held by a Suspension

**What to build:** Since ticket 02, a Suspended Campaign's matured money stays in Escrow Hold on purpose (CONTEXT.md, Escrow Hold). The Admin reconcile report's deferred-escrow watchdog flags any PAID Payment whose escrow is 14+ days past maturity and unreleased. Its comment treats "no in-flight Refund" as unexpected, so every held Payment of a Suspended Campaign will show up there as an anomaly. Keep reporting those Payments, since an Admin still wants to see frozen money, but label them with the known cause: the Campaign is Suspended. They must not look like a stuck sweep. Payments that are unexplained today stay unexplained.

**Blocked by:** 02

**Status:** done

- [x] A watchdog entry whose Campaign is effectively SUSPENDED carries a distinguishable cause (for example `cause: "SUSPENDED"`). Other entries are unchanged
- [x] The report's comments and field docs describe the new cause. Existing consumers keep working, because the change only adds fields
- [ ] Route tests cover a Suspended Campaign's held Payment, an unexplained one, and a Trip one. Full suite green, tsc adds no errors

## Comments

- 2026-10-04 (sapu checkbox, Track D): kotak 1 dan 2 dicentang: `cause: 'SUSPENDED'` ada di `src/app/api/admin/reconcile/route.ts` (komentar dan teks dokumentasi laporan menjelaskannya, field hanya ditambah). Kotak 3 tidak dicentang: tes route untuk ketiga kasus ada (`route.test.ts`: entri ber-cause, tanpa cause, dan Trip), tetapi "full suite green, tsc adds no errors" adalah fakta CI yang tidak bisa dibuktikan dari kode.
