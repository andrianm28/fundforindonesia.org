import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';
import { AdminRefundCreateForm } from '@/components/admin/AdminRefundCreateForm';
import type { Kind } from '@/generated/prisma/client';

export const dynamic = 'force-dynamic';

type RouteContext = { searchParams: Promise<{ q?: string }> };

/**
 * ticket 23: an Admin creates a Refund for a Donation, found by the same
 * two handles a Donation is ever looked up by elsewhere in this codebase --
 * its id (donasi-saya) or its Receipt token (receipt/[token]) -- not by a
 * new search feature this ticket does not ask for.
 *
 * Resolving to the Campaign slug and the Donation's paid Payment happens
 * HERE, server-side, so AdminRefundCreateForm can post to the EXISTING
 * POST /api/campaigns/[slug]/refunds route unchanged: that route already
 * expects a campaign slug and a paymentId, and this page is the thin layer
 * that gets an Admin from "a Donation" to those two values. No route is
 * added for this lookup -- a Server Component reads the database directly,
 * the same way /admin/payouts already does for its own queue.
 *
 * ONE PAID PAYMENT. At most one Payment per Donation ever reaches PAID
 * (schema.prisma, partial unique index) -- `findFirst` here is a formality,
 * not a "pick one of many" choice.
 *
 * THE KIND HINT IS A HINT, NOT A GATE (ticket 06; ADR 0013). The three
 * allowed technical-failure reasons are shown so an Admin does not have to
 * memorise or guess them, but `requireRefundAllowedForKind`
 * (src/lib/money/refunds.ts) is what actually enforces the rule -- this
 * page enforces nothing.
 */

type ResolvedDonation = {
  campaignSlug: string;
  campaignTitle: string;
  kind: Kind;
  paymentId: string;
  paymentAmount: number;
} | null;

async function resolveDonation(query: string): Promise<ResolvedDonation | 'no-payment'> {
  const byId = await prisma.donation.findUnique({
    where: { id: query },
    select: { id: true, campaign: { select: { id: true, slug: true, title: true, kind: true } } },
  });

  const donation =
    byId ??
    (
      await prisma.receipt.findUnique({
        where: { token: query },
        select: {
          donation: { select: { id: true, campaign: { select: { id: true, slug: true, title: true, kind: true } } } },
        },
      })
    )?.donation ??
    null;

  if (!donation) return null;

  const payment = await prisma.payment.findFirst({
    where: { donationId: donation.id, status: 'PAID' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true },
  });
  if (!payment) return 'no-payment';

  return {
    campaignSlug: donation.campaign.slug,
    campaignTitle: donation.campaign.title,
    kind: donation.campaign.kind,
    paymentId: payment.id,
    paymentAmount: payment.amount,
  };
}

export default async function AdminNewRefundPage({ searchParams }: RouteContext) {
  const { q } = await searchParams;
  const resolved = q ? await resolveDonation(q) : undefined;

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Buat Refund</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cari Donation dengan ID donasi atau token resi, lalu ajukan Refund untuk Payment-nya yang sudah lunas.
        </p>
      </div>

      <form method="GET" className="mb-6 flex gap-2">
        <label className="sr-only" htmlFor="q">
          ID donasi atau token resi
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q ?? ''}
          aria-label="ID donasi atau token resi"
          placeholder="ID donasi atau token resi"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
        />
        <button type="submit" className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white">
          Cari
        </button>
      </form>

      {resolved === null && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Donation tidak ditemukan untuk ID atau token resi tersebut.
        </p>
      )}

      {resolved === 'no-payment' && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Belum ada Payment yang lunas untuk Donation ini -- Refund hanya bisa diajukan atas Payment yang sudah PAID.
        </p>
      )}

      {resolved && resolved !== 'no-payment' && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Campaign</p>
          <p className="mb-3 text-lg font-semibold text-gray-900">{resolved.campaignTitle}</p>
          <p className="text-xs text-gray-500">Jumlah Payment</p>
          <p className="mb-4 text-sm font-medium text-gray-900">{formatRupiah(resolved.paymentAmount)}</p>

          {resolved.kind !== 'DONATION' && (
            <p className="mb-4 text-xs text-gray-500">
              Kind {resolved.kind}: Refund hanya untuk kegagalan teknis -- salah bayar, bayar ganda, atau dana masuk
              setelah Campaign ditutup (ADR 0013). Diperiksa oleh server, ini hanya pengingat.
            </p>
          )}

          <AdminRefundCreateForm campaignSlug={resolved.campaignSlug} paymentId={resolved.paymentId} />
        </div>
      )}
    </div>
  );
}
