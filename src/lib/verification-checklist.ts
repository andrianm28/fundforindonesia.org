import type {
  Prisma,
  PrismaClient,
  VerificationChecklistAuditAction,
  VerificationChecklistItem,
} from "@/generated/prisma/client";
import { KINDS, type CampaignKind } from "./campaign-kind";

/**
 * The Admin-configured verification checklist (verification-request 04, PRD
 * §7.1 "configured from the panel, not code"). Admins add, reword, reorder,
 * mark required or optional, scope items to one Kind or leave them general
 * ("Semua"), and deactivate or reactivate items; nothing is
 * ever deleted. Every change writes a VerificationChecklistAuditEntry with the
 * actor, the time, and the item before and after, in the same transaction.
 *
 * Edits apply only to Verification Requests submitted afterwards:
 * `submitCampaign` copies the active items for the Campaign's Kind (the
 * general items plus its Kind's own) into each request, so an existing
 * request's checklist is its own and nothing here touches it.
 *
 * Callers establish the ADMIN Capacity (the routes do, through
 * withAssignmentCheck); these commands take the acting user's id to audit.
 */

export const MAX_LABEL_LENGTH = 300;

/** The audited shape of an item: everything but its id. */
type ItemState = Pick<VerificationChecklistItem, "label" | "required" | "position" | "active" | "kind">;

export class ChecklistItemNotFoundError extends Error {
  constructor() {
    super("Item checklist tidak ditemukan.");
    this.name = "ChecklistItemNotFoundError";
  }
}

export class InvalidChecklistChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChecklistChangeError";
  }
}

/** The HTTP answer for a refusal from this module, or null for anything else. */
export function checklistErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof ChecklistItemNotFoundError) return { status: 404, error: error.message };
  if (error instanceof InvalidChecklistChangeError) return { status: 400, error: error.message };
  return null;
}

/** Every item, active or not, in checklist order: what the editor shows. */
export async function listChecklistItems(
  prisma: PrismaClient,
  filter?: { kind?: CampaignKind | null }
): Promise<VerificationChecklistItem[]> {
  // No filter is every item; a Kind is its own items plus the general ones,
  // the same set a submission of that Kind snapshots.
  const where =
    filter?.kind === undefined
      ? {}
      : filter.kind === null
        ? { kind: null }
        : { OR: [{ kind: null }, { kind: filter.kind }] };
  return prisma.verificationChecklistItem.findMany({ where, orderBy: { position: "asc" } });
}

function stateOf(item: ItemState): ItemState {
  return { label: item.label, required: item.required, position: item.position, active: item.active, kind: item.kind };
}

function cleanLabel(label: unknown): string {
  if (typeof label !== "string" || label.trim() === "") {
    throw new InvalidChecklistChangeError("Label item checklist wajib diisi.");
  }
  const trimmed = label.trim();
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new InvalidChecklistChangeError(`Label item checklist paling panjang ${MAX_LABEL_LENGTH} karakter.`);
  }
  return trimmed;
}

function cleanFlag(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidChecklistChangeError(`${name} harus bernilai true atau false.`);
  }
  return value;
}

/**
 * The Kind an item is scoped to, or null for the general ("Semua") items
 * every Kind's submission snapshots. Absent on add is general; on edit
 * absent leaves the scope alone, while an explicit null moves the item back
 * to general.
 */
function cleanKind(value: unknown): CampaignKind | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !(KINDS as readonly string[]).includes(value)) {
    throw new InvalidChecklistChangeError("Kind item checklist tidak dikenal.");
  }
  return value as CampaignKind;
}

type Tx = Prisma.TransactionClient;

async function audit(
  tx: Tx,
  entry: { itemId: string; action: VerificationChecklistAuditAction; before: ItemState | null; after: ItemState; actorId: string; now: Date }
) {
  await tx.verificationChecklistAuditEntry.create({
    data: {
      itemId: entry.itemId,
      action: entry.action,
      before: entry.before ?? undefined,
      after: entry.after,
      actedById: entry.actorId,
      actedAt: entry.now,
    },
  });
}

/**
 * Serialises every command that computes positions from the whole list
 * (adding, reordering), so two Admins acting at once never hand out the same
 * position or swap against a stale neighbour. A table lock, not
 * `SELECT ... FOR UPDATE`, which locks nothing on an empty checklist. SHARE
 * ROW EXCLUSIVE conflicts with itself and with writes, but not with plain
 * reads, so `submitCampaign` snapshotting the checklist never waits on it.
 */
async function lockChecklist(tx: Tx) {
  await tx.$executeRaw`LOCK TABLE "VerificationChecklistItem" IN SHARE ROW EXCLUSIVE MODE`;
}

/** Adds an item, active, after the last one. `kind` scopes it to one Kind; absent is general. */
export async function addChecklistItem(
  prisma: PrismaClient,
  params: { actorId: string; label: unknown; required: unknown; kind?: unknown; now?: Date }
): Promise<VerificationChecklistItem> {
  const label = cleanLabel(params.label);
  const required = cleanFlag(params.required, "Wajib");
  const kind = cleanKind(params.kind);
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await lockChecklist(tx);
    const items = await tx.verificationChecklistItem.findMany({ orderBy: { position: "asc" } });
    const position = items.length === 0 ? 1 : items[items.length - 1].position + 1;
    const item = await tx.verificationChecklistItem.create({ data: { label, required, position, active: true, kind } });
    await audit(tx, { itemId: item.id, action: "CREATED", before: null, after: stateOf(item), actorId: params.actorId, now });
    return item;
  });
}

/**
 * Rewords an item, marks it required or optional, scopes it to one Kind or
 * back to general, or deactivates or reactivates it: any of `label`,
 * `required`, `kind` and `active`, at least one. A change that leaves the
 * item as it was writes no audit entry.
 */
export async function editChecklistItem(
  prisma: PrismaClient,
  params: {
    actorId: string;
    itemId: string;
    changes: { label?: unknown; required?: unknown; kind?: unknown; active?: unknown };
    now?: Date;
  }
): Promise<VerificationChecklistItem> {
  const { changes } = params;
  const data: Partial<ItemState> = {};
  if (changes.label !== undefined) data.label = cleanLabel(changes.label);
  if (changes.required !== undefined) data.required = cleanFlag(changes.required, "Wajib");
  if (changes.kind !== undefined) data.kind = cleanKind(changes.kind);
  if (changes.active !== undefined) data.active = cleanFlag(changes.active, "Aktif");
  if (Object.keys(data).length === 0) {
    throw new InvalidChecklistChangeError("Tidak ada perubahan untuk item checklist.");
  }
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    // Lock the row so `before` is the state this change actually replaces.
    await tx.$queryRaw`SELECT id FROM "VerificationChecklistItem" WHERE id = ${params.itemId} FOR UPDATE`;
    const current = await tx.verificationChecklistItem.findUnique({ where: { id: params.itemId } });
    if (!current) throw new ChecklistItemNotFoundError();

    const before = stateOf(current);
    const after = { ...before, ...data };
    if (sameState(before, after)) return current;

    const item = await tx.verificationChecklistItem.update({ where: { id: current.id }, data });
    await audit(tx, { itemId: item.id, action: "UPDATED", before, after: stateOf(item), actorId: params.actorId, now });
    return item;
  });
}

export type MoveDirection = "up" | "down";

/**
 * Swaps an item's position with its neighbour's, active or not, since the
 * editor lists inactive items in place. Moving the first item up or the last
 * down changes nothing and writes no audit entry. Each item whose position
 * changes gets its own audit entry.
 */
export async function moveChecklistItem(
  prisma: PrismaClient,
  params: { actorId: string; itemId: string; direction: unknown; now?: Date }
): Promise<VerificationChecklistItem[]> {
  const { direction } = params;
  if (direction !== "up" && direction !== "down") {
    throw new InvalidChecklistChangeError("Arah pindah harus up atau down.");
  }
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await lockChecklist(tx);
    const items = await tx.verificationChecklistItem.findMany({ orderBy: { position: "asc" } });
    const index = items.findIndex((item) => item.id === params.itemId);
    if (index === -1) throw new ChecklistItemNotFoundError();
    const neighbourIndex = direction === "up" ? index - 1 : index + 1;
    const neighbour = items[neighbourIndex];
    if (!neighbour) return items;

    const moving = items[index];
    const moved: VerificationChecklistItem[] = [];
    for (const [item, position] of [[moving, neighbour.position], [neighbour, moving.position]] as const) {
      const updated = await tx.verificationChecklistItem.update({ where: { id: item.id }, data: { position } });
      await audit(tx, { itemId: item.id, action: "UPDATED", before: stateOf(item), after: stateOf(updated), actorId: params.actorId, now });
      moved.push(updated);
    }
    return items.map((item) => moved.find((m) => m.id === item.id) ?? item).sort((a, b) => a.position - b.position);
  });
}

function sameState(a: ItemState, b: ItemState): boolean {
  return a.label === b.label && a.required === b.required && a.position === b.position && a.active === b.active && a.kind === b.kind;
}
