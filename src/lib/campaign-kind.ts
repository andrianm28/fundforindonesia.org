import type { Kind } from "@/generated/prisma/client";

/**
 * A Campaign's Kind and the rules it drives (CONTEXT.md, Kind; ADR 0002,
 * 0013), as both the server and the browser need them. A type-only import
 * of the Prisma enum, so the generated client never reaches a browser
 * bundle.
 *
 * Only the deadline rule lives here. The Fundraising Permit rule keys off
 * the same value (./collecting-entity.ts, prd-compliance 10); Kind
 * Authorisation (11), the per-Kind document checklist and Platform Fee (17)
 * will too.
 */
export type CampaignKind = Kind;

/**
 * Every Kind the platform offers, in the order the creation form and the
 * catalogue show them. `ZAKAT` is deliberately absent: Zakat was taken out of
 * scope (2026-10-16) but stays in the Prisma enum so existing rows still load.
 */
export const KINDS = ["DONATION", "WAKAF", "HIBAH"] as const satisfies readonly CampaignKind[];

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

/** Whether a Campaign lacks the deadline its Kind requires. */
export function missingRequiredDeadline(campaign: {
  kind: CampaignKind;
  deadline?: Date | string | null;
}): boolean {
  return (campaign.deadline === null || campaign.deadline === undefined) && deadlineRequired(campaign.kind);
}

/** The longest a Campaign may run from now to its deadline, wakaf excepted (C12, 2026-10-04). */
export const MAX_CAMPAIGN_MONTHS = 12;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * The latest deadline a Campaign judged at `from` may name: the end of the WIB
 * calendar day that is 12 months after `from`'s WIB date (day clamped to the
 * month's end), so a form filled in WIB is judged by date, not by clock time.
 */
export function latestAllowedDeadline(from: Date): Date {
  const wib = new Date(from.getTime() + WIB_OFFSET_MS);
  const year = wib.getUTCFullYear() + Math.floor((wib.getUTCMonth() + MAX_CAMPAIGN_MONTHS) / 12);
  const month = (wib.getUTCMonth() + MAX_CAMPAIGN_MONTHS) % 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(wib.getUTCDate(), daysInMonth);
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - WIB_OFFSET_MS);
}

/**
 * Whether a Campaign's deadline lies beyond 12 months from `from`. Exactly 12
 * months is allowed. Wakaf is exempt (its endowment may run on), and so is a
 * Campaign with no deadline: that case is `missingRequiredDeadline`'s.
 */
export function exceedsMaxDuration(
  campaign: { kind: CampaignKind; deadline?: Date | string | null },
  from: Date
): boolean {
  if (campaign.kind === "WAKAF" || campaign.deadline === null || campaign.deadline === undefined) return false;
  return new Date(campaign.deadline).getTime() > latestAllowedDeadline(from).getTime();
}

/** The one sentence every refusal of a too-distant deadline shows. */
export const MAX_DURATION_MESSAGE = `Tenggat Campaign paling lama ${MAX_CAMPAIGN_MONTHS} bulan dari sekarang; hanya Campaign wakaf yang dikecualikan. Bila ini Draft lama, perbarui tenggat sebelum mengajukan.`;

/** The one sentence every refusal of a missing deadline shows. */
export function deadlineRequiredMessage(kind: CampaignKind): string {
  return `Tenggat wajib diisi untuk Campaign ber-Kind ${KIND_LABEL[kind]}.`;
}
