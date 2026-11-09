import type { PrismaClient } from "@/generated/prisma/client";
import { resolveOperations } from "@/lib/operations";
import { countedPaymentWhere } from "@/lib/money/counted-payment";
import { formatRupiah } from "@/lib/utils/currency";

/**
 * Zakat distribution records (PKS pemenuhan 19, ADR 0028).
 *
 * The platform collects zakat for the configured institution through the
 * ordinary donation path, and pays the institution through the existing Payout
 * machinery. What the institution then gives to mustahik happens off this
 * platform. An Admin writes it down here, so the books and the report show
 * collected, distributed and remaining zakat side by side.
 *
 * A RECORD ONLY: nothing in this file posts a LedgerEntry, creates a Payout or
 * touches a balance (the property test of ledger writers keeps it that way).
 * Existing Payout rows could not be reused: a Payout is money leaving a
 * Campaign balance to a verified bank account, which is already how the
 * institution is paid; a distribution is a statement about money after it left.
 *
 * What is recorded can never exceed what the institution has received, read
 * from real (non-beta) confirmed zakat Donations, under a per-institution lock
 * so two Admins cannot spend the same remainder.
 */

export const ZAKAT_ASNAF = [
  "FAKIR",
  "MISKIN",
  "AMIL",
  "MUALAF",
  "RIQAB",
  "GHARIM",
  "FISABILILLAH",
  "IBNU_SABIL",
] as const;
export type ZakatAsnafValue = (typeof ZAKAT_ASNAF)[number];

export const ZAKAT_ASNAF_LABEL: Record<ZakatAsnafValue, string> = {
  FAKIR: "Fakir",
  MISKIN: "Miskin",
  AMIL: "Amil",
  MUALAF: "Mualaf",
  RIQAB: "Riqab",
  GHARIM: "Gharim",
  FISABILILLAH: "Fi sabilillah",
  IBNU_SABIL: "Ibnu sabil",
};

export const MAX_RECIPIENT_SUMMARY = 300;
export const MAX_DISTRIBUTION_NOTE = 500;

export class InvalidZakatDistributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidZakatDistributionError";
  }
}

export class ZakatRecipientNotConfiguredError extends Error {
  constructor() {
    super("Lembaga penerima zakat belum ditetapkan di Pengaturan Operasional.");
    this.name = "ZakatRecipientNotConfiguredError";
  }
}

export class ZakatDistributionExceedsReceivedError extends Error {
  constructor(remaining: number) {
    super(`Penyaluran melebihi zakat yang diterima lembaga. Sisa yang bisa dicatat: ${formatRupiah(remaining)}.`);
    this.name = "ZakatDistributionExceedsReceivedError";
  }
}

type Db = Pick<PrismaClient, "donation" | "refund" | "zakatDistribution">;

/** What the institution received as zakat, what has been recorded as distributed, and the difference. */
export async function zakatPosition(
  db: Db,
  organisationId: string,
): Promise<{ received: number; distributed: number; remaining: number }> {
  const zakatOf = { kind: "ZAKAT", collectingEntityId: organisationId } as const;
  const [received, refunded, distributed] = await Promise.all([
    db.donation.aggregate({
      where: {
        paymentStatus: "confirmed",
        payments: { some: countedPaymentWhere() },
        campaign: zakatOf,
      },
      _sum: { amount: true },
    }),
    // A Refund hands money back to the muzaki. Donation.paymentStatus stays
    // "confirmed" through any Refund (the Payment turns REFUNDED only on a full
    // one), so Refund rows that are approved or paid are subtracted.
    db.refund.aggregate({
      where: {
        status: { in: ["APPROVED", "PROCESSING", "COMPLETED"] },
        payment: { ...countedPaymentWhere(), donation: { campaign: zakatOf } },
      },
      _sum: { amount: true },
    }),
    db.zakatDistribution.aggregate({ where: { organisationId }, _sum: { amount: true } }),
  ]);
  const r = Math.max(0, (received._sum.amount ?? 0) - (refunded._sum.amount ?? 0));
  const d = distributed._sum.amount ?? 0;
  return { received: r, distributed: d, remaining: r - d };
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "2026-11-08" -> the instant that WIB day starts; anything else, or a day after today in WIB, is refused. */
function parseWibDay(raw: unknown, now: Date): Date {
  const match = typeof raw === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null;
  if (!match) throw new InvalidZakatDistributionError("Tanggal penyaluran harus berformat YYYY-MM-DD.");
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d || y < 2020) {
    throw new InvalidZakatDistributionError("Tanggal penyaluran tidak valid.");
  }
  const start = new Date(utc.getTime() - WIB_OFFSET_MS);
  const todayWib = new Date(now.getTime() + WIB_OFFSET_MS);
  const todayStart = Date.UTC(todayWib.getUTCFullYear(), todayWib.getUTCMonth(), todayWib.getUTCDate()) - WIB_OFFSET_MS;
  if (start.getTime() > todayStart) throw new InvalidZakatDistributionError("Tanggal penyaluran tidak boleh di masa depan.");
  return start;
}

function cleanInput(input: unknown, now: Date) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidZakatDistributionError("Data penyaluran harus berupa objek.");
  }
  const raw = input as Record<string, unknown>;
  const { amount, asnaf } = raw;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1) {
    throw new InvalidZakatDistributionError("Nominal penyaluran harus bilangan bulat rupiah, minimal Rp1.");
  }
  if (typeof asnaf !== "string" || !(ZAKAT_ASNAF as readonly string[]).includes(asnaf)) {
    throw new InvalidZakatDistributionError("Golongan penerima (asnaf) tidak dikenal.");
  }
  const distributedAt = parseWibDay(raw.distributedAt, now);
  const recipientSummary = typeof raw.recipientSummary === "string" ? raw.recipientSummary.trim() : "";
  if (recipientSummary === "" || recipientSummary.length > MAX_RECIPIENT_SUMMARY) {
    throw new InvalidZakatDistributionError(
      `Ringkasan penerima wajib diisi, paling banyak ${MAX_RECIPIENT_SUMMARY} karakter (tanpa nama perorangan).`,
    );
  }
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (note.length > MAX_DISTRIBUTION_NOTE) {
    throw new InvalidZakatDistributionError(`Catatan paling banyak ${MAX_DISTRIBUTION_NOTE} karakter.`);
  }
  return { amount, asnaf: asnaf as ZakatAsnafValue, distributedAt, recipientSummary, note: note === "" ? null : note };
}

/**
 * An Admin records that the configured zakat institution distributed zakat.
 * Validated here so the route and any later caller agree. Writes one
 * ZakatDistribution row and nothing else.
 */
export async function recordZakatDistribution(
  db: Db & Pick<PrismaClient, "$transaction" | "siteSetting">,
  params: { actorId: string; input: unknown; now?: Date },
) {
  const now = params.now ?? new Date();
  const data = cleanInput(params.input, now);

  return db.$transaction(async (tx) => {
    const { zakat } = await resolveOperations(tx);
    if (zakat.recipientOrganisationId === null) throw new ZakatRecipientNotConfiguredError();
    const organisationId = zakat.recipientOrganisationId;

    // One recording at a time per institution: the check below and the write
    // must not interleave with another Admin's, or both could spend the same remainder.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`zakat-distribution:${organisationId}`}::text))`;
    const position = await zakatPosition(tx, organisationId);
    if (data.amount > position.remaining) throw new ZakatDistributionExceedsReceivedError(Math.max(0, position.remaining));

    return tx.zakatDistribution.create({ data: { organisationId, ...data, recordedById: params.actorId } });
  });
}

export function listZakatDistributions(db: Pick<PrismaClient, "zakatDistribution">, organisationId: string) {
  return db.zakatDistribution.findMany({
    where: { organisationId },
    orderBy: [{ distributedAt: "desc" }, { recordedAt: "desc" }],
    select: {
      id: true,
      amount: true,
      asnaf: true,
      distributedAt: true,
      recipientSummary: true,
      note: true,
      recordedAt: true,
      recordedBy: { select: { name: true } },
    },
  });
}

export function zakatDistributionErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof InvalidZakatDistributionError) return { status: 400, error: error.message };
  if (error instanceof ZakatRecipientNotConfiguredError) return { status: 409, error: error.message };
  if (error instanceof ZakatDistributionExceedsReceivedError) return { status: 409, error: error.message };
  return null;
}
