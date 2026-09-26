import type { Kind } from "@/generated/prisma/client";

/**
 * A Campaign's Kind and the rules it drives (CONTEXT.md, Kind; ADR 0002,
 * 0013), as both the server and the browser need them. A type-only import
 * of the Prisma enum, so the generated client never reaches a browser
 * bundle.
 *
 * Only the deadline rule lives here so far. Kind Authorisation, the
 * Collecting Entity and its Fundraising Permit (prd-compliance 10, 11), the
 * per-Kind document checklist and Platform Fee (17) will key off the same
 * value.
 */
export type CampaignKind = Kind;

/** Every Kind, in the order the creation form and the catalogue offer them. */
export const KINDS: readonly CampaignKind[] = ["DONATION", "ZAKAT", "WAKAF", "HIBAH"];

/** The Indonesian name of each Kind, as screens show it. */
export const KIND_LABEL: Record<CampaignKind, string> = {
  DONATION: "Donasi",
  ZAKAT: "Zakat",
  WAKAF: "Wakaf",
  HIBAH: "Hibah",
};

/** Narrows a string (a query parameter, a form value) to a Kind, case-insensitively. */
export function parseKind(value: string): CampaignKind | null {
  const upper = value.toUpperCase();
  return KINDS.find((kind) => kind === upper) ?? null;
}

/**
 * A deadline is mandatory on every Kind except wakaf, whose endowment may
 * stay open (CONTEXT.md, Campaign).
 */
export function deadlineRequired(kind: CampaignKind): boolean {
  return kind !== "WAKAF";
}
