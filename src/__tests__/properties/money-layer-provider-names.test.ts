import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The money layer names Payment Providers; it does not talk to them.
 *
 * provider-withdrawals.ts needed to know that "Sumopod" and "sumopod" are one
 * provider, which is a question about a NAME. It got that answer from the
 * @/lib/payments barrel, and the barrel is also where the adapters live --
 * sumopod-provider reaches node:crypto -- so a name-only need pulled every
 * adapter into the money layer's module graph, and the direction of the
 * dependency stopped being visible in the import line.
 *
 * So the names live in a leaf (@/lib/payments/provider-names), the barrel
 * re-exports it, and the money layer reads the leaf. There is nothing to
 * assert at runtime -- no adapter has a load-time side effect to observe --
 * so this scans the money layer's own files for the dependency it must not
 * have, the way subject-lock-single-owner.test.ts scans src for a second
 * copy of the row lock.
 *
 * The pattern is a VALUE import. `import type { PaymentMethod } from
 * '@/lib/payments'` is erased at compile time and drags nothing in, and two
 * money modules take types from the barrel on purpose.
 */
const MONEY_DIR = join(process.cwd(), "src", "lib", "money");

/** A value import from the barrel. `[^;'"]` cannot cross a statement boundary. */
const BARREL_VALUE_IMPORT = /import\s+(?!type\b)[^;'"]*?from\s*['"]@\/lib\/payments['"]/;

const moneyFiles = () =>
  readdirSync(MONEY_DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

describe("the money layer takes provider names, not provider adapters", () => {
  it("has no module importing the adapter barrel for a value", () => {
    const offenders = moneyFiles().filter((name) =>
      BARREL_VALUE_IMPORT.test(readFileSync(join(MONEY_DIR, name), "utf8")),
    );

    expect(offenders).toEqual([]);
  });

  it("reads the name from the leaf, which is what makes the scan above a rule rather than a shrug", () => {
    // Otherwise the test above would also pass on a money layer that named no
    // provider at all. The claim is that the name is taken from the leaf, by
    // whichever module takes it -- no file is picked here on purpose.
    const importers = moneyFiles().filter((name) =>
      /from\s*['"]@\/lib\/payments\/provider-names['"]/.test(readFileSync(join(MONEY_DIR, name), "utf8")),
    );

    expect(importers).not.toEqual([]);
  });

  // Guards the guard: if the pattern stopped recognising a value import, the
  // test above would pass vacuously.
  it("tells a value import from a type-only one, and from the leaf", () => {
    expect(BARREL_VALUE_IMPORT.test("import { canonicalPaymentProviderName } from '@/lib/payments';")).toBe(true);
    expect(BARREL_VALUE_IMPORT.test("import type { PaymentProvider } from '@/lib/payments';")).toBe(false);
    expect(BARREL_VALUE_IMPORT.test("import type { PaymentMethod } from '@/lib/payments';")).toBe(false);
    expect(
      BARREL_VALUE_IMPORT.test("import { canonicalPaymentProviderName } from '@/lib/payments/provider-names';"),
    ).toBe(false);
  });
});
