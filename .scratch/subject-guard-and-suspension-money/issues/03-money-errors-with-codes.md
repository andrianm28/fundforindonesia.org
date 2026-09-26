# 03: Money errors carry codes and map to HTTP in one place

**What to build:** The existing money errors gain a `code` and an Indonesian message, and map through the same error-to-HTTP function as the lifecycle module. The money errors are: demo Campaign, bank account not eligible, insufficient balance, self-approval (the two duplicate classes merged into one), invalid Payout/Refund status, and not found. The Payout and Refund routes (Campaign and Trip) drop their `instanceof` chains. Error classes remain exported, so existing catches keep working.

**Blocked by:** 02

**Status:** done

- [ ] Every money error has a stable code and an Indonesian message; the HTTP statuses stay as they are today unless the spec says otherwise
- [ ] One mapping function serves the lifecycle and money errors. The money routes use it and no longer chain `instanceof`
- [ ] Route tests assert codes rather than English strings. Full suite green, tsc adds no errors
