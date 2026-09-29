import { describe, it, expect } from "vitest";
import { kindAuthorisationsNeedingRenewal } from "./kind-authorisation-renewal";

const NOW = new Date("2026-09-29T00:00:00.000Z");
const day = (offset: number) => new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);

function organisation(
  id: string,
  kindAuthorisations: { id: string; kind: "ZAKAT" | "WAKAF" | "HIBAH"; validFrom: Date; validTo: Date }[],
) {
  return { id, name: `Org ${id}`, kindAuthorisations };
}

describe("kindAuthorisationsNeedingRenewal", () => {
  it("lists an authorisation that expires within 30 days as expiring", () => {
    const items = kindAuthorisationsNeedingRenewal(
      [organisation("o1", [{ id: "k1", kind: "ZAKAT", validFrom: day(-300), validTo: day(10) }])],
      NOW,
    );
    expect(items).toEqual([
      expect.objectContaining({ id: "k1", organisationName: "Org o1", kind: "ZAKAT", status: "expiring" }),
    ]);
  });

  it("lists an authorisation whose date has passed as lapsed", () => {
    const items = kindAuthorisationsNeedingRenewal(
      [organisation("o1", [{ id: "k1", kind: "WAKAF", validFrom: day(-400), validTo: day(-2) }])],
      NOW,
    );
    expect(items).toEqual([expect.objectContaining({ id: "k1", status: "lapsed" })]);
  });

  it("leaves out an authorisation that is valid beyond the 30-day horizon", () => {
    const items = kindAuthorisationsNeedingRenewal(
      [organisation("o1", [{ id: "k1", kind: "ZAKAT", validFrom: day(-10), validTo: day(31) }])],
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("leaves out a lapsed authorisation that a later one of the same Kind already replaces", () => {
    const items = kindAuthorisationsNeedingRenewal(
      [
        organisation("o1", [
          { id: "old", kind: "ZAKAT", validFrom: day(-400), validTo: day(-5) },
          { id: "renewed", kind: "ZAKAT", validFrom: day(-5), validTo: day(360) },
        ]),
      ],
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("still lists a lapsed authorisation when the later one is of a different Kind", () => {
    const items = kindAuthorisationsNeedingRenewal(
      [
        organisation("o1", [
          { id: "old", kind: "ZAKAT", validFrom: day(-400), validTo: day(-5) },
          { id: "other", kind: "HIBAH", validFrom: day(-5), validTo: day(360) },
        ]),
      ],
      NOW,
    );
    expect(items.map((item) => item.id)).toEqual(["old"]);
  });

  it("puts the lapsed ones first, then the soonest to lapse", () => {
    const items = kindAuthorisationsNeedingRenewal(
      [
        organisation("o1", [
          { id: "later", kind: "ZAKAT", validFrom: day(-100), validTo: day(20) },
          { id: "lapsed", kind: "WAKAF", validFrom: day(-400), validTo: day(-1) },
          { id: "sooner", kind: "HIBAH", validFrom: day(-100), validTo: day(3) },
        ]),
      ],
      NOW,
    );
    expect(items.map((item) => item.id)).toEqual(["lapsed", "sooner", "later"]);
  });
});
