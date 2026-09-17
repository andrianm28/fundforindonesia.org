import { describe, it, expect } from "vitest";
import { ROLE_LEVELS, hasRole, isAtLeast, requireRole } from "./roles";

describe("roles", () => {
  describe("ROLE_LEVELS", () => {
    it("defines correct numeric levels for all roles", () => {
      expect(ROLE_LEVELS.DONOR).toBe(0);
      expect(ROLE_LEVELS.CAMPAIGN_CREATOR).toBe(1);
      expect(ROLE_LEVELS.MODERATOR).toBe(2);
      expect(ROLE_LEVELS.ADMIN).toBe(3);
    });
  });

  describe("hasRole", () => {
    it("returns true for exact match", () => {
      expect(hasRole("ADMIN", "ADMIN")).toBe(true);
      expect(hasRole("DONOR", "DONOR")).toBe(true);
    });

    it("returns false for non-matching roles", () => {
      expect(hasRole("DONOR", "ADMIN")).toBe(false);
      expect(hasRole("MODERATOR", "ADMIN")).toBe(false);
    });

    it("defaults null role to DONOR", () => {
      expect(hasRole(null, "DONOR")).toBe(true);
      expect(hasRole(null, "ADMIN")).toBe(false);
    });

    it("defaults undefined role to DONOR", () => {
      expect(hasRole(undefined, "DONOR")).toBe(true);
      expect(hasRole(undefined, "CAMPAIGN_CREATOR")).toBe(false);
    });
  });

  describe("isAtLeast", () => {
    it("ADMIN is at least every role", () => {
      expect(isAtLeast("ADMIN", "ADMIN")).toBe(true);
      expect(isAtLeast("ADMIN", "MODERATOR")).toBe(true);
      expect(isAtLeast("ADMIN", "CAMPAIGN_CREATOR")).toBe(true);
      expect(isAtLeast("ADMIN", "DONOR")).toBe(true);
    });

    it("MODERATOR is at least MODERATOR, CAMPAIGN_CREATOR, DONOR", () => {
      expect(isAtLeast("MODERATOR", "ADMIN")).toBe(false);
      expect(isAtLeast("MODERATOR", "MODERATOR")).toBe(true);
      expect(isAtLeast("MODERATOR", "CAMPAIGN_CREATOR")).toBe(true);
      expect(isAtLeast("MODERATOR", "DONOR")).toBe(true);
    });

    it("CAMPAIGN_CREATOR is at least CAMPAIGN_CREATOR and DONOR", () => {
      expect(isAtLeast("CAMPAIGN_CREATOR", "ADMIN")).toBe(false);
      expect(isAtLeast("CAMPAIGN_CREATOR", "MODERATOR")).toBe(false);
      expect(isAtLeast("CAMPAIGN_CREATOR", "CAMPAIGN_CREATOR")).toBe(true);
      expect(isAtLeast("CAMPAIGN_CREATOR", "DONOR")).toBe(true);
    });

    it("DONOR is only at least DONOR", () => {
      expect(isAtLeast("DONOR", "ADMIN")).toBe(false);
      expect(isAtLeast("DONOR", "MODERATOR")).toBe(false);
      expect(isAtLeast("DONOR", "CAMPAIGN_CREATOR")).toBe(false);
      expect(isAtLeast("DONOR", "DONOR")).toBe(true);
    });

    it("defaults null/undefined to DONOR level", () => {
      expect(isAtLeast(null, "DONOR")).toBe(true);
      expect(isAtLeast(null, "CAMPAIGN_CREATOR")).toBe(false);
      expect(isAtLeast(undefined, "DONOR")).toBe(true);
      expect(isAtLeast(undefined, "ADMIN")).toBe(false);
    });
  });

  describe("requireRole", () => {
    it("does not throw when role meets requirement", () => {
      expect(() => requireRole("ADMIN", "ADMIN")).not.toThrow();
      expect(() => requireRole("ADMIN", "DONOR")).not.toThrow();
      expect(() => requireRole("MODERATOR", "DONOR")).not.toThrow();
      expect(() => requireRole("DONOR", "DONOR")).not.toThrow();
    });

    it("throws when role is insufficient", () => {
      expect(() => requireRole("DONOR", "ADMIN")).toThrow(
        "Requires at least ADMIN role"
      );
      expect(() => requireRole("CAMPAIGN_CREATOR", "MODERATOR")).toThrow(
        "Requires at least MODERATOR role"
      );
    });

    it("throws with descriptive message", () => {
      expect(() => requireRole("DONOR", "MODERATOR")).toThrow(
        "Requires at least MODERATOR role"
      );
    });

    it("defaults null/undefined to DONOR and throws for higher roles", () => {
      expect(() => requireRole(null, "CAMPAIGN_CREATOR")).toThrow(
        "Requires at least CAMPAIGN_CREATOR role"
      );
      expect(() => requireRole(undefined, "ADMIN")).toThrow(
        "Requires at least ADMIN role"
      );
    });

    it("defaults null/undefined to DONOR and does not throw for DONOR", () => {
      expect(() => requireRole(null, "DONOR")).not.toThrow();
      expect(() => requireRole(undefined, "DONOR")).not.toThrow();
    });
  });
});
