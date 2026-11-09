import type { PrismaClient } from "@/generated/prisma/client";
import { parseRecapPeriod } from "@/lib/money/finance-recap";
import { csvTextCell } from "@/lib/money/finance-recap-csv";

/**
 * The zakat transactions report (PKS pemenuhan 19, ADR 0028), as CSV for the
 * Admin. Read-only, and ONLY Donations on Campaigns of Kind ZAKAT, so zakat is
 * kept apart from general donations in every figure this report gives (the
 * finance recap does the same by Kind, see splitZakatFromRecap). Each text cell
 * passes through the same formula-injection guard as the finance recap CSV.
 */

export type ZakatTransactionRow = {
  donationId: string;
  /** When it was paid, else when the Donation was made. */
  paidAt: Date;
  amount: number;
  /** The Donation's own status: pending, confirmed or failed. */
  status: string;
  paymentMethod: string;
  campaignTitle: string;
  recipientName: string;
  /** Null when the muzaki asked to be anonymous or was anonymised: no name is written. */
  donorName: string | null;
  /** A beta Payment moved no real money. */
  sandbox: boolean;
};

type Db = Pick<PrismaClient, "donation">;

/** Donations on zakat Campaigns paid (else made) in the WIB months `from` to `to` (both inclusive, 'YYYY-MM'), oldest first. */
export async function zakatTransactions(db: Db, range: { from: string; to: string }): Promise<ZakatTransactionRow[]> {
  const { from, toExclusive } = parseRecapPeriod(range.from, range.to);
  const donations = await db.donation.findMany({
    // Wide enough for both dates a row can show; the exact cut is made below on the date it shows.
    where: {
      campaign: { kind: "ZAKAT" },
      OR: [{ createdAt: { gte: from, lt: toExclusive } }, { payments: { some: { paidAt: { gte: from, lt: toExclusive } } } }],
    },
    select: {
      id: true,
      amount: true,
      paymentStatus: true,
      paymentMethod: true,
      createdAt: true,
      isAnonymous: true,
      anonymisedAt: true,
      guestName: true,
      donor: { select: { name: true } },
      campaign: { select: { title: true, collectingEntity: { select: { name: true } } } },
      payments: { select: { sandbox: true, paidAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const rows = donations.map((d) => {
    const payment = d.payments[0];
    const named = !d.isAnonymous && d.anonymisedAt === null;
    return {
      donationId: d.id,
      paidAt: payment?.paidAt ?? d.createdAt,
      amount: d.amount,
      status: d.paymentStatus,
      paymentMethod: d.paymentMethod,
      campaignTitle: d.campaign.title,
      recipientName: d.campaign.collectingEntity?.name ?? "",
      donorName: named ? (d.donor?.name ?? d.guestName ?? null) : null,
      sandbox: payment?.sandbox ?? false,
    };
  });
  // The month filter and the order follow the date the report displays (paidAt).
  return rows
    .filter((r) => r.paidAt.getTime() >= from.getTime() && r.paidAt.getTime() < toExclusive.getTime())
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
}

const HEADERS = [
  "Tanggal (WIB)",
  "ID donasi",
  "Nominal",
  "Status",
  "Metode",
  "Campaign zakat",
  "Lembaga penerima",
  "Muzaki",
  "Mode",
] as const;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const wibDate = (at: Date) => new Date(at.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The report as CSV, with a closing line that sums only real, confirmed money:
 * pending, failed and beta (sandbox) rows are listed but never counted.
 */
export function zakatTransactionsCsv(rows: readonly ZakatTransactionRow[]): string {
  const out = [HEADERS.map(csvTextCell).join(",")];
  let total = 0;
  for (const r of rows) {
    if (r.status === "confirmed" && !r.sandbox) total += r.amount;
    out.push(
      [
        csvTextCell(wibDate(r.paidAt)),
        csvTextCell(r.donationId),
        String(r.amount),
        csvTextCell(r.status),
        csvTextCell(r.paymentMethod),
        csvTextCell(r.campaignTitle),
        csvTextCell(r.recipientName),
        csvTextCell(r.donorName ?? "(anonim)"),
        csvTextCell(r.sandbox ? "Uji beta" : "Nyata"),
      ].join(","),
    );
  }
  out.push([csvTextCell("Total diterima (terkonfirmasi, bukan uji)"), "", String(total), "", "", "", "", "", ""].join(","));
  return out.join("\r\n") + "\r\n";
}
