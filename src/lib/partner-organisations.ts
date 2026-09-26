import { Prisma } from "@/generated/prisma/client";
import type {
  FundraisingPermit,
  Kind,
  PartnerOrganisation,
  PartnerOrganisationAuditAction,
  PrismaClient,
} from "@/generated/prisma/client";
import { DomainError, type PartnerOrganisationErrorCode } from "./domain-errors";
import { parseKind } from "./campaign-kind";

/**
 * The Verifier's register of Partner Organisations and their Fundraising
 * Permits (prd-compliance 10; CONTEXT.md, Partner Organisation, Fundraising
 * Permit). A Verifier registers an organisation after checking its legal
 * documents, linked to the one Fundraiser account that acts for it, sets
 * whether it accepts individual Campaigns, and records each permit (number,
 * issuer, Kinds covered, valid from and to). Nothing is ever deleted; every
 * registration and change writes a PartnerOrganisationAuditEntry with the
 * actor, the time, and the record before and after, in the same transaction.
 *
 * Callers establish the VERIFIER assignment (the routes do, through
 * withAssignmentCheck); these commands take the acting person's id. As with
 * a Campaign they own, a Verifier never acts on an organisation their own
 * account acts for.
 */

export abstract class PartnerOrganisationError extends DomainError {
  abstract override readonly code: PartnerOrganisationErrorCode;
}

/** A malformed or missing field; `field` names it. */
export class InvalidPartnerOrganisationError extends PartnerOrganisationError {
  readonly code = "PARTNER_ORGANISATION_INVALID";
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "InvalidPartnerOrganisationError";
  }
}

export class PartnerOrganisationNotFoundError extends PartnerOrganisationError {
  readonly code = "PARTNER_ORGANISATION_NOT_FOUND";
  constructor() {
    super("Partner Organisation tidak ditemukan.");
    this.name = "PartnerOrganisationNotFoundError";
  }
}

export class FundraisingPermitNotFoundError extends PartnerOrganisationError {
  readonly code = "FUNDRAISING_PERMIT_NOT_FOUND";
  constructor() {
    super("Fundraising Permit tidak ditemukan.");
    this.name = "FundraisingPermitNotFoundError";
  }
}

/** The account already acts for a Partner Organisation; one account, one organisation. */
export class FundraiserAlreadyLinkedError extends PartnerOrganisationError {
  readonly code = "FUNDRAISER_ALREADY_LINKED";
  constructor() {
    super("Akun ini sudah bertindak atas nama Partner Organisation lain.");
    this.name = "FundraiserAlreadyLinkedError";
  }
}

/** The Verifier's own account acts, or would act, for this organisation. */
export class OwnPartnerOrganisationError extends PartnerOrganisationError {
  readonly code = "OWN_PARTNER_ORGANISATION_CONFLICT";
  constructor() {
    super(
      "Anda tidak dapat bertindak sebagai Verifier atas Partner Organisation yang diwakili akun Anda sendiri. Tindakan ini harus dilakukan Verifier lain."
    );
    this.name = "OwnPartnerOrganisationError";
  }
}

const MAX_TEXT_LENGTH = 300;

type Tx = Prisma.TransactionClient;

function cleanText(raw: unknown, label: string, field: string): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") throw new InvalidPartnerOrganisationError(`${label} wajib diisi.`, field);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new InvalidPartnerOrganisationError(`${label} maksimal ${MAX_TEXT_LENGTH} karakter.`, field);
  }
  return text;
}

function cleanFlag(raw: unknown, label: string, field: string): boolean {
  if (typeof raw !== "boolean") {
    throw new InvalidPartnerOrganisationError(`${label} harus bernilai true atau false.`, field);
  }
  return raw;
}

function cleanDate(raw: unknown, label: string, field: string): Date {
  const date = typeof raw === "string" || raw instanceof Date ? new Date(raw) : new Date(NaN);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidPartnerOrganisationError(`${label} tidak valid.`, field);
  }
  return date;
}

function cleanKinds(raw: unknown): Kind[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InvalidPartnerOrganisationError("Pilih minimal satu Kind yang dicakup izin.", "kinds");
  }
  const kinds = raw.map((value) => (typeof value === "string" ? parseKind(value) : null));
  if (kinds.some((kind) => kind === null)) {
    throw new InvalidPartnerOrganisationError("Kind tidak dikenal.", "kinds");
  }
  return Array.from(new Set(kinds as Kind[]));
}

function requireWindow(validFrom: Date, validTo: Date): void {
  if (validTo.getTime() < validFrom.getTime()) {
    throw new InvalidPartnerOrganisationError("Akhir masa berlaku tidak boleh sebelum awalnya.", "validTo");
  }
}

// ==================== Audit ====================

type OrganisationState = Pick<PartnerOrganisation, "name" | "fundraiserId" | "acceptsIndividualCampaigns">;

type PermitState = { number: string; issuer: string; kinds: Kind[]; validFrom: string; validTo: string };

function organisationState(organisation: OrganisationState): OrganisationState {
  return {
    name: organisation.name,
    fundraiserId: organisation.fundraiserId,
    acceptsIndividualCampaigns: organisation.acceptsIndividualCampaigns,
  };
}

function permitState(permit: Pick<FundraisingPermit, "number" | "issuer" | "kinds" | "validFrom" | "validTo">): PermitState {
  return {
    number: permit.number,
    issuer: permit.issuer,
    kinds: [...permit.kinds],
    validFrom: permit.validFrom.toISOString(),
    validTo: permit.validTo.toISOString(),
  };
}

async function audit(
  tx: Tx,
  entry: {
    organisationId: string;
    permitId?: string;
    action: PartnerOrganisationAuditAction;
    before: OrganisationState | PermitState | null;
    after: OrganisationState | PermitState;
    actorId: string;
    now: Date;
  }
): Promise<void> {
  await tx.partnerOrganisationAuditEntry.create({
    data: {
      partnerOrganisationId: entry.organisationId,
      permitId: entry.permitId ?? null,
      action: entry.action,
      before: entry.before ?? undefined,
      after: entry.after,
      actedById: entry.actorId,
      actedAt: entry.now,
    },
  });
}

function same(a: object, b: object): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Locks the organisation row, then reads it, so `before` is the state a
 * change replaces and a permit is never recorded against one being edited.
 */
async function lockOrganisation(tx: Tx, organisationId: string, actorId: string): Promise<PartnerOrganisation> {
  await tx.$queryRaw`SELECT id FROM "PartnerOrganisation" WHERE id = ${organisationId} FOR UPDATE`;
  const organisation = await tx.partnerOrganisation.findUnique({ where: { id: organisationId } });
  if (!organisation) throw new PartnerOrganisationNotFoundError();
  if (organisation.fundraiserId === actorId) throw new OwnPartnerOrganisationError();
  return organisation;
}

// ==================== Commands ====================

/**
 * Registers a Partner Organisation, linked to the account registered under
 * `fundraiserEmail`, which must not already act for another one.
 */
export async function registerPartnerOrganisation(
  prisma: PrismaClient,
  params: {
    actorId: string;
    name: unknown;
    fundraiserEmail: unknown;
    acceptsIndividualCampaigns: unknown;
    now?: Date;
  }
): Promise<PartnerOrganisation> {
  const name = cleanText(params.name, "Nama Partner Organisation", "name");
  const email = cleanText(params.fundraiserEmail, "Email akun Fundraiser", "fundraiserEmail");
  const acceptsIndividualCampaigns = cleanFlag(
    params.acceptsIndividualCampaigns,
    "Menaungi Campaign perorangan",
    "acceptsIndividualCampaigns"
  );
  const now = params.now ?? new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.user.findUnique({ where: { email } });
      if (!account) {
        throw new InvalidPartnerOrganisationError("Tidak ada akun dengan email itu.", "fundraiserEmail");
      }
      if (account.id === params.actorId) throw new OwnPartnerOrganisationError();
      if (await tx.partnerOrganisation.findUnique({ where: { fundraiserId: account.id } })) {
        throw new FundraiserAlreadyLinkedError();
      }
      const organisation = await tx.partnerOrganisation.create({
        data: {
          name,
          fundraiserId: account.id,
          acceptsIndividualCampaigns,
          registeredById: params.actorId,
          registeredAt: now,
        },
      });
      await audit(tx, {
        organisationId: organisation.id,
        action: "REGISTERED",
        before: null,
        after: organisationState(organisation),
        actorId: params.actorId,
        now,
      });
      return organisation;
    });
  } catch (error) {
    // Two registrations of one account racing: the unique fundraiserId keeps the first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new FundraiserAlreadyLinkedError();
    }
    throw error;
  }
}

/**
 * Renames an organisation or changes whether it accepts individual
 * Campaigns: `name` and `acceptsIndividualCampaigns`, at least one. Its
 * linked account never changes here. A change that leaves it as it was
 * writes no audit entry. Campaigns already naming it keep it; a Campaign
 * still to be approved is judged against the new setting.
 */
export async function updatePartnerOrganisation(
  prisma: PrismaClient,
  params: {
    actorId: string;
    organisationId: string;
    changes: { name?: unknown; acceptsIndividualCampaigns?: unknown };
    now?: Date;
  }
): Promise<PartnerOrganisation> {
  const { changes } = params;
  const data: Partial<OrganisationState> = {};
  if (changes.name !== undefined) data.name = cleanText(changes.name, "Nama Partner Organisation", "name");
  if (changes.acceptsIndividualCampaigns !== undefined) {
    data.acceptsIndividualCampaigns = cleanFlag(
      changes.acceptsIndividualCampaigns,
      "Menaungi Campaign perorangan",
      "acceptsIndividualCampaigns"
    );
  }
  if (Object.keys(data).length === 0) {
    throw new InvalidPartnerOrganisationError("Tidak ada perubahan untuk Partner Organisation.");
  }
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const current = await lockOrganisation(tx, params.organisationId, params.actorId);
    const before = organisationState(current);
    if (same(before, { ...before, ...data })) return current;
    const organisation = await tx.partnerOrganisation.update({ where: { id: current.id }, data });
    await audit(tx, {
      organisationId: current.id,
      action: "UPDATED",
      before,
      after: organisationState(organisation),
      actorId: params.actorId,
      now,
    });
    return organisation;
  });
}

/** Records a Fundraising Permit the organisation holds. */
export async function recordFundraisingPermit(
  prisma: PrismaClient,
  params: {
    actorId: string;
    organisationId: string;
    number: unknown;
    issuer: unknown;
    kinds: unknown;
    validFrom: unknown;
    validTo: unknown;
    now?: Date;
  }
): Promise<FundraisingPermit> {
  const number = cleanText(params.number, "Nomor izin", "number");
  const issuer = cleanText(params.issuer, "Penerbit izin", "issuer");
  const kinds = cleanKinds(params.kinds);
  const validFrom = cleanDate(params.validFrom, "Awal masa berlaku", "validFrom");
  const validTo = cleanDate(params.validTo, "Akhir masa berlaku", "validTo");
  requireWindow(validFrom, validTo);
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const organisation = await lockOrganisation(tx, params.organisationId, params.actorId);
    const permit = await tx.fundraisingPermit.create({
      data: {
        partnerOrganisationId: organisation.id,
        number,
        issuer,
        kinds,
        validFrom,
        validTo,
        recordedById: params.actorId,
        recordedAt: now,
      },
    });
    await audit(tx, {
      organisationId: organisation.id,
      permitId: permit.id,
      action: "PERMIT_RECORDED",
      before: null,
      after: permitState(permit),
      actorId: params.actorId,
      now,
    });
    return permit;
  });
}

/**
 * Corrects or renews a permit: any of `number`, `issuer`, `kinds`,
 * `validFrom` and `validTo`, at least one. A change that leaves it as it
 * was writes no audit entry. Campaigns under it are judged against the new
 * window from the next read, since accepting Donations is computed lazily.
 */
export async function updateFundraisingPermit(
  prisma: PrismaClient,
  params: {
    actorId: string;
    organisationId: string;
    permitId: string;
    changes: { number?: unknown; issuer?: unknown; kinds?: unknown; validFrom?: unknown; validTo?: unknown };
    now?: Date;
  }
): Promise<FundraisingPermit> {
  const { changes } = params;
  const data: Partial<Pick<FundraisingPermit, "number" | "issuer" | "kinds" | "validFrom" | "validTo">> = {};
  if (changes.number !== undefined) data.number = cleanText(changes.number, "Nomor izin", "number");
  if (changes.issuer !== undefined) data.issuer = cleanText(changes.issuer, "Penerbit izin", "issuer");
  if (changes.kinds !== undefined) data.kinds = cleanKinds(changes.kinds);
  if (changes.validFrom !== undefined) data.validFrom = cleanDate(changes.validFrom, "Awal masa berlaku", "validFrom");
  if (changes.validTo !== undefined) data.validTo = cleanDate(changes.validTo, "Akhir masa berlaku", "validTo");
  if (Object.keys(data).length === 0) {
    throw new InvalidPartnerOrganisationError("Tidak ada perubahan untuk Fundraising Permit.");
  }
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const organisation = await lockOrganisation(tx, params.organisationId, params.actorId);
    const current = await tx.fundraisingPermit.findUnique({ where: { id: params.permitId } });
    if (!current || current.partnerOrganisationId !== organisation.id) throw new FundraisingPermitNotFoundError();
    const next = { ...current, ...data };
    requireWindow(next.validFrom, next.validTo);
    const before = permitState(current);
    if (same(before, permitState(next))) return current;
    const permit = await tx.fundraisingPermit.update({ where: { id: current.id }, data });
    await audit(tx, {
      organisationId: organisation.id,
      permitId: permit.id,
      action: "PERMIT_UPDATED",
      before,
      after: permitState(permit),
      actorId: params.actorId,
      now,
    });
    return permit;
  });
}

// ==================== Reads ====================

export type SponsorOption = { id: string; name: string };

/**
 * What the Campaign creation form offers `userId` as Collecting Entity: the
 * organisation their account acts for, which every Campaign of theirs
 * collects under, or else the organisations accepting individual
 * Campaigns, by name.
 */
export async function sponsorOptionsFor(
  prisma: Pick<PrismaClient, "partnerOrganisation">,
  userId: string
): Promise<{ own: SponsorOption | null; sponsors: SponsorOption[] }> {
  const own = await prisma.partnerOrganisation.findUnique({ where: { fundraiserId: userId } });
  if (own) return { own: { id: own.id, name: own.name }, sponsors: [] };
  const sponsors = await prisma.partnerOrganisation.findMany({
    where: { acceptsIndividualCampaigns: true },
    orderBy: { name: "asc" },
  });
  return { own: null, sponsors: sponsors.map((o) => ({ id: o.id, name: o.name })) };
}
