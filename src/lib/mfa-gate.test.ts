// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { enrollGraceDays, resolveMfa } from "./mfa-gate";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 9);
const base = { now, graceDays: 0 };

describe("resolveMfa", () => {
  it("leaves a person with no panel assignment alone, enrolled or not", () => {
    expect(resolveMfa({ ...base, assignments: [], enabledAtMs: null, privilegedSinceMs: null })).toEqual({
      state: "none",
      assignments: [],
    });
    expect(resolveMfa({ ...base, assignments: [], enabledAtMs: now - DAY, privilegedSinceMs: null }).state).toBe("none");
  });

  it("holds an enrolled Admin at 'challenge' with NO effective assignments until the factor is proved", () => {
    const r = resolveMfa({ ...base, assignments: ["ADMIN", "VERIFIER"], enabledAtMs: now - DAY, privilegedSinceMs: now - 9 * DAY });
    expect(r).toEqual({ state: "challenge", assignments: [] });
  });

  it("restores the assignments once the factor is proved for THIS enrolment", () => {
    const r = resolveMfa({
      ...base,
      assignments: ["VERIFIER"],
      enabledAtMs: now - DAY,
      verifiedEnabledAtMs: now - DAY,
      privilegedSinceMs: now - 9 * DAY,
    });
    expect(r).toEqual({ state: "verified", assignments: ["VERIFIER"] });
  });

  it("does not honour a proof made for an earlier enrolment (the factor was reset and redone)", () => {
    const r = resolveMfa({
      ...base,
      assignments: ["ADMIN"],
      enabledAtMs: now - DAY,
      verifiedEnabledAtMs: now - 5 * DAY,
      privilegedSinceMs: now - 9 * DAY,
    });
    expect(r.state).toBe("challenge");
    expect(r.assignments).toEqual([]);
  });

  it("holds an unenrolled holder at 'enroll' with no assignments when the grace is 0", () => {
    const r = resolveMfa({ ...base, assignments: ["ADMIN"], enabledAtMs: null, privilegedSinceMs: now });
    expect(r).toEqual({ state: "enroll", assignments: [] });
  });

  it("lets an unenrolled holder through only inside the grace window, counted from the assignment", () => {
    const within = resolveMfa({ now, graceDays: 7, assignments: ["ADMIN"], enabledAtMs: null, privilegedSinceMs: now - 6 * DAY });
    expect(within).toEqual({ state: "grace", assignments: ["ADMIN"] });
    const over = resolveMfa({ now, graceDays: 7, assignments: ["ADMIN"], enabledAtMs: null, privilegedSinceMs: now - 7 * DAY });
    expect(over).toEqual({ state: "enroll", assignments: [] });
  });

  it("never grants grace to an enrolled holder who has not proved the factor", () => {
    const r = resolveMfa({ now, graceDays: 365, assignments: ["ADMIN"], enabledAtMs: now - DAY, privilegedSinceMs: now });
    expect(r.state).toBe("challenge");
  });

  it("treats an unknown assignment date as past the grace", () => {
    const r = resolveMfa({ now, graceDays: 7, assignments: ["ADMIN"], enabledAtMs: null, privilegedSinceMs: null });
    expect(r.state).toBe("enroll");
  });
});

describe("enrollGraceDays", () => {
  it("defaults to 0", () => {
    expect(enrollGraceDays({})).toBe(0);
  });
  it("reads a whole number of days", () => {
    expect(enrollGraceDays({ MFA_ENROLL_GRACE_DAYS: "14" })).toBe(14);
  });
  it("falls back to 0 for anything that is not a non-negative whole number", () => {
    for (const bad of ["", "-1", "abc", "1.5", "NaN", "Infinity"]) {
      expect(enrollGraceDays({ MFA_ENROLL_GRACE_DAYS: bad })).toBe(0);
    }
  });
});

describe("enrollGraceDays: production guard", () => {
  afterEach(() => vi.restoreAllMocks());

  // A fresh module each time: the clamp logs once per process.
  async function load() {
    vi.resetModules();
    return (await import("./mfa-gate")).enrollGraceDays;
  }

  it("clamps a value above 30 to 30 in production, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const grace = await load();
    const env = { NODE_ENV: "production", MFA_ENROLL_GRACE_DAYS: "36500" };
    expect(grace(env)).toBe(30);
    expect(grace(env)).toBe(30);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("mfa_grace_clamped");
  });

  it("leaves 30 and below alone in production, without logging", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const grace = await load();
    expect(grace({ NODE_ENV: "production", MFA_ENROLL_GRACE_DAYS: "30" })).toBe(30);
    expect(grace({ NODE_ENV: "production", MFA_ENROLL_GRACE_DAYS: "7" })).toBe(7);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the big value in CI's e2e, where CI is 'true', even with NODE_ENV=production", async () => {
    const grace = await load();
    expect(grace({ NODE_ENV: "production", CI: "true", MFA_ENROLL_GRACE_DAYS: "36500" })).toBe(36500);
  });

  it("does not clamp outside production", async () => {
    const grace = await load();
    expect(grace({ NODE_ENV: "development", MFA_ENROLL_GRACE_DAYS: "36500" })).toBe(36500);
    expect(grace({ MFA_ENROLL_GRACE_DAYS: "90" })).toBe(90);
  });

  it("clamps in production when CI is anything but the exact string 'true'", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const grace = await load();
    expect(grace({ NODE_ENV: "production", CI: "1", MFA_ENROLL_GRACE_DAYS: "100" })).toBe(30);
  });
});
