import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

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

const change = z.object({
  field: z.enum(["donationsOpen", "maintenanceOn", "maintenanceMessage"]),
  from: z.union([z.boolean(), z.string()]),
  to: z.union([z.boolean(), z.string()]),
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
  })
  .strict();

export type Operations = z.infer<typeof operationsSchema>;
export type OperationsHistoryEntry = z.infer<typeof historyEntry>;
export type OperationsPatch = z.infer<typeof patchSchema>;

export const DEFAULT_OPERATIONS: Operations = {
  donationsOpen: true,
  maintenance: { on: false, message: "" },
  history: [],
};

export class InvalidOperationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationsError";
  }
}

type OperationsDb = Pick<PrismaClient, "siteSetting">;

/** The switches in force: the stored row if it parses, else the defaults. */
export async function resolveOperations(db: OperationsDb): Promise<Operations> {
  const row = await db.siteSetting.findUnique({ where: { key: OPERATIONS_KEY } });
  if (!row) return structuredClone(DEFAULT_OPERATIONS);
  const parsed = operationsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_OPERATIONS);
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
 * An Admin changes one or more switches. Validated here so the route and any
 * later caller agree. A patch that changes nothing writes nothing, and so
 * adds no history entry.
 */
export async function setOperations(
  db: OperationsDb,
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

  const current = await resolveOperations(db);
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
  await db.siteSetting.upsert({
    where: { key: OPERATIONS_KEY },
    create: { key: OPERATIONS_KEY, value, updatedById: params.actorId },
    update: { value, updatedById: params.actorId },
  });
  return next;
}

export function operationsErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof InvalidOperationsError) return { status: 400, error: error.message };
  return null;
}

/** What a visitor and a refused write are told while maintenance is on and no message was set. */
export const MAINTENANCE_DEFAULT_MESSAGE =
  "Situs sedang dalam pemeliharaan. Silakan coba lagi beberapa saat lagi.";
