import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { PASSWORD_HASH_COST, isHashAtCurrentCost } from "@/lib/password-hash-cost";

// Real bcryptjs, deliberately. The defect these tests guard is a *number* — the
// cost factor that bcrypt writes into the hash's own `$2a$NN$` prefix — so a
// mocked bcrypt cannot see it and would pass on the broken code. The price is
// that hashing runs at the production factor, hence the generous timeouts.

describe("reading the cost factor back off a stored hash", () => {
  // The cost is read out of the hash's own prefix, so an account weakened by
  // an older password change is recognisable without a second column to keep
  // in sync and without a migration.
  it("reports a hash at the current factor as current, and a weaker one as not", async () => {
    const atCurrentCost = await bcrypt.hash("correct-horse-123", PASSWORD_HASH_COST);
    const weakened = await bcrypt.hash("correct-horse-123", 4);

    expect(isHashAtCurrentCost(atCurrentCost)).toBe(true);
    expect(isHashAtCurrentCost(weakened)).toBe(false);
  }, 30_000);

  it("reports a hash it cannot read a factor out of as not current, so it gets replaced", () => {
    expect(isHashAtCurrentCost("")).toBe(false);
    expect(isHashAtCurrentCost("not-a-bcrypt-hash")).toBe(false);
  });
});
