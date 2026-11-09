import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { MAX_DONATION_AMOUNT, MIN_DONATION_AMOUNT } from "@/lib/donations";
import { formatRupiah } from "@/lib/utils/currency";
import { holdsValidKindAuthorisation, holdsValidPermit } from "@/lib/collecting-entity";

/**
 * Setelan operasional: the two switches an Admin flips from the panel
 * (/admin/operasional) without a rebuild, and the only place their shape and
 * defaults are written down (PKS pemenuhan, ticket 01).
 *
 *   donationsOpen  every route that takes money (Donation, its retry, the
 *                  Volunteer Trip Fee) refuses with 503 while this is false.
 *                  It is a SECOND lock beside NEXT_PUBLIC_DONATIONS_ENABLED
 *                  (src/lib/donations.ts): money flows only when the env is
 *                  `true` AND this is open. The panel can close the gate, never
 *                  open one the environment keeps shut. Webhooks are not
 *                  behind it: a payment already under way must still be recorded.
 *   maintenance    public pages show a banner and every non-Admin write route
 *                  refuses with 503 (src/proxy.ts). /admin, /api/admin, the
 *                  webhooks, health and login keep working.
 *   donationPresets  the quick-pick amounts on the donate page (PKS pemenuhan,
 *                  ticket 02): 3 to 8 whole-rupiah values, unique, ascending,
 *                  each at least the minimum donation. A stored value that no
 *                  longer qualifies (or is absent) falls back to the defaults
 *                  for the presets only; the switches keep their stored values.
 *  zakat          the zakat module's switch, nisab and recipient (PKS pemenuhan
 *                  19, ADR 0028). OFF by default and Admin-only. While off,
 *                  every zakat route answers 404 and a zakat checkout is
 *                  refused. It can only be turned on with a nisab, a recipient
 *                  Partner Organisation, and that organisation holding a
 *                  permit and a Kind Authorisation for zakat valid now.
 *
 * One SiteSetting row, key `operations`, kept apart from Pengaturan Laman
 * Publik (src/lib/site-settings.ts): that module's schema does not know this
 * key, so the public-content route cannot write it. The row also carries the
 * change history (who, when, old and new value), newest first and capped, so
 * no schema change is needed. Nothing is seeded: no row means donations open
 * and maintenance off.
 */

export const OPERATIONS_KEY = "operations";
export const MAX_OPERATIONS_HISTORY = 50;
export const MAX_MAINTENANCE_MESSAGE = 500;

export const MIN_DONATION_PRESETS = 3;
export const MAX_DONATION_PRESETS = 8;
export const DEFAULT_DONATION_PRESETS: readonly number[] = [20000, 50000, 100000, 250000, 500000];

const rupiahList = z.array(z.number());

export const MAX_ZAKAT_NISAB = 10_000_000_000;

const zakatNisab = z
  .number({ error: "Nisab harus berupa angka." })
  .int("Nisab harus bilangan bulat rupiah.")
  .min(1, "Nisab harus lebih dari Rp0.")
  .max(MAX_ZAKAT_NISAB, `Nisab maksimal ${formatRupiah(MAX_ZAKAT_NISAB)}.`);

const DEFAULT_ZAKAT = { enabled: false, nisabAmount: 0, recipientOrganisationId: null as string | null };

// A row written before this section existed has no `zakat` key: it reads as OFF.
const zakatSection = z
  .object({
    enabled: z.boolean(),
    nisabAmount: z.number().int().min(0),
    recipientOrganisationId: z.string().min(1).nullable(),
  })
  .catch(() => ({ ...DEFAULT_ZAKAT }));

const presetAmounts = z
  .array(
    z
      .number({ error: "Nominal preset harus berupa angka." })
      .int("Nominal preset harus bilangan bulat rupiah.")
      .min(MIN_DONATION_AMOUNT, `Nominal preset minimal ${formatRupiah(MIN_DONATION_AMOUNT)}.`)
      .max(MAX_DONATION_AMOUNT, `Nominal preset maksimal ${formatRupiah(MAX_DONATION_AMOUNT)}.`),
    { error: "Preset nominal harus berupa daftar angka." },
  )
  .min(MIN_DONATION_PRESETS, `Preset nominal minimal ${MIN_DONATION_PRESETS} nilai.`)
  .max(MAX_DONATION_PRESETS, `Preset nominal maksimal ${MAX_DONATION_PRESETS} nilai.`)
  .refine((v) => new Set(v).size === v.length, "Preset nominal tidak boleh ada yang sama.")
  .transform((v) => [...v].sort((a, b) => a - b));

const change = z.object({
  field: z.enum([
    "donationsOpen",
    "maintenanceOn",
    "maintenanceMessage",
    "donationPresets",
    "zakatEnabled",
    "zakatNisabAmount",
    "zakatRecipientOrganisationId",
  ]),
  from: z.union([z.boolean(), z.string(), z.number(), z.null(), rupiahList]),
  to: z.union([z.boolean(), z.string(), z.number(), z.null(), rupiahList]),
});

const historyEntry = z.object({
  at: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  changes: z.array(change),
});

const operationsSchema = z.object({
  donationsOpen: z.boolean(),
  maintenance: z.object({ on: z.boolean(), message: z.string().max(MAX_MAINTENANCE_MESSAGE) }),
  donationPresets: presetAmounts.catch(() => [...DEFAULT_DONATION_PRESETS]),
  zakat: zakatSection,
  history: z.array(historyEntry).max(MAX_OPERATIONS_HISTORY),
});

const patchSchema = z
  .object({
    donationsOpen: z.boolean().optional(),
    maintenanceOn: z.boolean().optional(),
    maintenanceMessage: z
      .string()
      .trim()
      .max(MAX_MAINTENANCE_MESSAGE, `Pesan maksimal ${MAX_MAINTENANCE_MESSAGE} karakter.`)
      .optional(),
    donationPresets: presetAmounts.optional(),
    zakatEnabled: z.boolean().optional(),
    zakatNisabAmount: zakatNisab.optional(),
    zakatRecipientOrganisationId: z.string().trim().min(1, "Lembaga penerima zakat tidak valid.").nullable().optional(),
  })
  .strict();

export type Operations = z.infer<typeof operationsSchema>;
export type OperationsHistoryEntry = z.infer<typeof historyEntry>;
export type OperationsPatch = z.infer<typeof patchSchema>;

export const DEFAULT_OPERATIONS: Operations = {
  donationsOpen: true,
  maintenance: { on: false, message: "" },
  donationPresets: [...DEFAULT_DONATION_PRESETS],
  zakat: { ...DEFAULT_ZAKAT },
  history: [],
};

export class OperationsConflictError extends Error {
  constructor() {
    super("Setelan berubah, muat ulang halaman lalu coba lagi.");
    this.name = "OperationsConflictError";
  }
}

export class InvalidOperationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationsError";
  }
}

/** The stored row exists but no longer parses; a save would overwrite what cannot be read. */
export class OperationsCorruptError extends Error {
  constructor() {
    super(
      "Setelan operasional tersimpan dalam keadaan rusak, sehingga tidak bisa disimpan dari panel. Perbaiki baris 'operations' di database lebih dulu.",
    );
    this.name = "OperationsCorruptError";
  }
}

export type OperationsDb = Pick<PrismaClient, "siteSetting">;

/** The row as stored (null: never written) with what it parses to, and its version. */
async function readOperations(db: OperationsDb): Promise<{
  operations: Operations;
  version: Date | null;
  corrupt: boolean;
}> {
  const row = await db.siteSetting.findUnique({ where: { key: OPERATIONS_KEY } });
  if (!row) return { operations: structuredClone(DEFAULT_OPERATIONS), version: null, corrupt: false };
  const parsed = operationsSchema.safeParse(row.value);
  return {
    operations: parsed.success ? parsed.data : structuredClone(DEFAULT_OPERATIONS),
    version: row.updatedAt,
    corrupt: !parsed.success,
  };
}

/**
 * The switches in force with whether the stored row was unreadable. Reads
 * still fall back to the defaults (the donation switch is not guessed from a
 * damaged row), but a caller that shows an Admin the state can say it is damaged.
 */
export async function resolveOperationsState(db: OperationsDb): Promise<{ operations: Operations; corrupt: boolean }> {
  const { operations, corrupt } = await readOperations(db);
  return { operations, corrupt };
}

/** The switches in force: the stored row if it parses, else the defaults. */
export async function resolveOperations(db: OperationsDb): Promise<Operations> {
  return (await readOperations(db)).operations;
}

/**
 * The same read for a public page: a database that cannot be reached must not
 * take the page down with it, so a failure shows the defaults.
 */
export async function resolveOperationsOrDefaults(db: OperationsDb): Promise<Operations> {
  try {
    return await resolveOperations(db);
  } catch {
    return structuredClone(DEFAULT_OPERATIONS);
  }
}

/** The quick-pick amounts for the donate page; the defaults if they cannot be read. */
export async function resolveDonationPresetsOrDefaults(db: OperationsDb): Promise<number[]> {
  return (await resolveOperationsOrDefaults(db)).donationPresets;
}

/**
 * Whether an Admin has switched donations off. Read by every route that takes
 * money. It fails CLOSED: if the row cannot be read, the money route refuses
 * (the database is needed to take the donation anyway, and an unreadable
 * switch is not a reason to guess "open").
 */
export async function donationsSwitchedOff(db: OperationsDb): Promise<boolean> {
  try {
    return !(await resolveOperations(db)).donationsOpen;
  } catch {
    return true;
  }
}

/**
 * Whether the zakat module is on. Read by every zakat route and by the
 * donation path before it takes a zakat checkout. It fails CLOSED: an
 * unreadable row means off, because the module's default is off.
 */
export async function zakatSwitchedOn(db: OperationsDb): Promise<boolean> {
  try {
    return (await resolveOperations(db)).zakat.enabled;
  } catch {
    return false;
  }
}

type KindValue = "DONATION" | "ZAKAT" | "WAKAF" | "HIBAH";
type RecipientLookup = {
  partnerOrganisation?: {
    findUnique: (args: {
      where: { id: string };
      select: {
        permits: { select: { kinds: true; validFrom: true; validTo: true } };
        kindAuthorisations: { select: { kind: true; validFrom: true; validTo: true } };
      };
    }) => Promise<{
      permits: { kinds: KindValue[]; validFrom: Date; validTo: Date }[];
      kindAuthorisations: { kind: KindValue; validFrom: Date; validTo: Date }[];
    } | null>;
  };
};

/**
 * The recipient of zakat must be an existing Partner Organisation (a verified
 * institution: only a Verifier registers one). Turning the module ON also
 * needs it to hold, now, a Fundraising Permit covering zakat and a zakat Kind
 * Authorisation: the legal prerequisites of PKS Pasal 12(2) put on record
 * (ADR 0028). The donation path judges the same two again at each checkout.
 */
async function requireLicensedRecipient(
  db: RecipientLookup,
  organisationId: string,
  now: Date,
  mustBeLicensed: boolean,
): Promise<void> {
  const lookup = db.partnerOrganisation;
  if (!lookup) throw new Error("partnerOrganisation is required to validate the zakat recipient");
  const org = await lookup.findUnique({
    where: { id: organisationId },
    select: {
      permits: { select: { kinds: true, validFrom: true, validTo: true } },
      kindAuthorisations: { select: { kind: true, validFrom: true, validTo: true } },
    },
  });
  if (!org) throw new InvalidOperationsError("Lembaga penerima zakat tidak ditemukan.");
  if (mustBeLicensed && !(holdsValidPermit(org, "ZAKAT", now) && holdsValidKindAuthorisation(org, "ZAKAT", now))) {
    throw new InvalidOperationsError(
      "Penanda zakat hanya bisa dihidupkan bila lembaga penerima memegang izin pengumpulan dan Kind Authorisation zakat yang berlaku saat ini.",
    );
  }
}

/**
 * An Admin changes one or more switches. Validated here so the route and any
 * later caller agree. A patch that changes nothing writes nothing, and so
 * adds no history entry.
 */
export async function setOperations(
  db: OperationsDb & RecipientLookup,
  params: { patch: unknown; actorId: string; actorName: string; now?: Date },
): Promise<Operations> {
  const parsed = patchSchema.safeParse(params.patch);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new InvalidOperationsError(first.message);
  }
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    throw new InvalidOperationsError("Tidak ada perubahan yang dikirim.");
  }

  const { operations: current, version, corrupt } = await readOperations(db);
  if (corrupt) {
    // Saving would write defaults over the unreadable row: reset donationsOpen
    // and wipe the history. Refuse instead and leave the row for repair.
    console.error("operations_row_corrupt", { key: OPERATIONS_KEY, actorId: params.actorId });
    throw new OperationsCorruptError();
  }
  const next: Operations = structuredClone(current);
  const changes: OperationsHistoryEntry["changes"] = [];

  if (patch.donationsOpen !== undefined && patch.donationsOpen !== current.donationsOpen) {
    next.donationsOpen = patch.donationsOpen;
    changes.push({ field: "donationsOpen", from: current.donationsOpen, to: patch.donationsOpen });
  }
  if (patch.maintenanceOn !== undefined && patch.maintenanceOn !== current.maintenance.on) {
    next.maintenance.on = patch.maintenanceOn;
    changes.push({ field: "maintenanceOn", from: current.maintenance.on, to: patch.maintenanceOn });
  }
  if (patch.maintenanceMessage !== undefined && patch.maintenanceMessage !== current.maintenance.message) {
    next.maintenance.message = patch.maintenanceMessage;
    changes.push({ field: "maintenanceMessage", from: current.maintenance.message, to: patch.maintenanceMessage });
  }

  if (patch.donationPresets !== undefined && !sameList(patch.donationPresets, current.donationPresets)) {
    next.donationPresets = patch.donationPresets;
    changes.push({ field: "donationPresets", from: current.donationPresets, to: patch.donationPresets });
  }

  if (patch.zakatNisabAmount !== undefined && patch.zakatNisabAmount !== current.zakat.nisabAmount) {
    next.zakat.nisabAmount = patch.zakatNisabAmount;
    changes.push({ field: "zakatNisabAmount", from: current.zakat.nisabAmount, to: patch.zakatNisabAmount });
  }
  if (
    patch.zakatRecipientOrganisationId !== undefined &&
    patch.zakatRecipientOrganisationId !== current.zakat.recipientOrganisationId
  ) {
    next.zakat.recipientOrganisationId = patch.zakatRecipientOrganisationId;
    changes.push({
      field: "zakatRecipientOrganisationId",
      from: current.zakat.recipientOrganisationId,
      to: patch.zakatRecipientOrganisationId,
    });
  }
  if (patch.zakatEnabled !== undefined && patch.zakatEnabled !== current.zakat.enabled) {
    next.zakat.enabled = patch.zakatEnabled;
    changes.push({ field: "zakatEnabled", from: current.zakat.enabled, to: patch.zakatEnabled });
  }

  // The recipient is validated whenever it changes or the module is being
  // turned on; the licence check applies whenever the module ends up on.
  const zakatTouched = changes.some((c) => c.field === "zakatEnabled" || c.field === "zakatRecipientOrganisationId");
  if (next.zakat.enabled && zakatTouched) {
    if (next.zakat.nisabAmount <= 0) throw new InvalidOperationsError("Isi nisab lebih dulu sebelum menghidupkan penanda zakat.");
    if (next.zakat.recipientOrganisationId === null) {
      throw new InvalidOperationsError("Pilih lembaga penerima zakat lebih dulu sebelum menghidupkan penanda zakat.");
    }
  }
  const recipientChanged = changes.some((c) => c.field === "zakatRecipientOrganisationId");
  // Turning OFF needs no check of anyone; only a recipient being set, or the module ending up on, does.
  if (next.zakat.recipientOrganisationId !== null && (recipientChanged || (next.zakat.enabled && zakatTouched))) {
    await requireLicensedRecipient(db, next.zakat.recipientOrganisationId, params.now ?? new Date(), next.zakat.enabled);
  }

  if (changes.length === 0) return current;

  next.history = [
    {
      at: (params.now ?? new Date()).toISOString(),
      actorId: params.actorId,
      actorName: params.actorName,
      changes,
    },
    ...current.history,
  ].slice(0, MAX_OPERATIONS_HISTORY);

  const value = next as unknown as Prisma.InputJsonValue;
  // Compare-and-set against the version read above, so two Admins saving at
  // once cannot overwrite each other's history entry or flip a switch back:
  // the second one is refused and reloads. No row yet: the create loses to a
  // concurrent first write through the primary key.
  if (version === null) {
    try {
      await db.siteSetting.create({ data: { key: OPERATIONS_KEY, value, updatedById: params.actorId } });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "P2002") throw new OperationsConflictError();
      throw error;
    }
  } else {
    const { count } = await db.siteSetting.updateMany({
      where: { key: OPERATIONS_KEY, updatedAt: version },
      data: { value, updatedById: params.actorId },
    });
    if (count === 0) throw new OperationsConflictError();
  }
  return next;
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

export function operationsErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof InvalidOperationsError) return { status: 400, error: error.message };
  if (error instanceof OperationsCorruptError) return { status: 422, error: error.message };
  if (error instanceof OperationsConflictError) return { status: 409, error: error.message };
  return null;
}

/** What a visitor and a refused write are told while maintenance is on and no message was set. */
export const MAINTENANCE_DEFAULT_MESSAGE =
  "Situs sedang dalam pemeliharaan. Silakan coba lagi beberapa saat lagi.";
