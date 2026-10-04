# 37: Dormant Balance 60-day report

**What to build:** An Admin can see money sitting unclaimed instead of discovering it much later.

**Blocked by:** 20

**Status:** done
PR #127, `src/lib/money/dormant-balances.ts`

- [x] Campaigns Expired or Completed still holding a Campaign Balance appear in an Admin report after 60 days
- [ ] Reminders to the Fundraiser are tracked so the count toward the 180-day definition is real
- [x] Reporting only: no automatic transfer, which stays out of scope

## Comments

- 2026-10-04 (sapu checkbox, Track D): kotak 1 dan 3 dicentang (`dormantBalanceReport`, ambang 60 hari, `src/lib/money/dormant-balances.ts`, layar `/admin/dormant-balances`; tidak ada kode pengalihan). Kotak 2 (pengingat ke Fundraiser dilacak untuk hitungan 180 hari) **tidak** dicentang: belum ada kode atau skema pengingat dormant. Itu ikut pekerjaan pengalihan Dormant Balance yang kini masuk Rilis 1 (item perluasan E2, `percepatan-full-rilis`).
