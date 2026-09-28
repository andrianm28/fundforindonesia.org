import { prisma } from '@/lib/prisma';
import { AdminManualContributionCreateForm } from '@/components/admin/AdminManualContributionCreateForm';

export const dynamic = 'force-dynamic';

type RouteContext = { searchParams: Promise<{ q?: string }> };

/**
 * ticket 26: an Admin finds the Campaign or Program a Manual Contribution
 * targets by its slug -- the same public handle a Campaign or a Program is
 * ever looked up by elsewhere, not a new search feature this ticket does
 * not ask for.
 *
 * Resolving to the target's id happens HERE, server-side, so
 * AdminManualContributionCreateForm can post the real campaignId/programId
 * POST /api/admin/manual-contributions expects unchanged -- this page is
 * the thin layer that gets an Admin from "a slug" to that id, the same
 * shape /admin/refunds/new already uses for a Donation.
 *
 * CAMPAIGN FIRST, THEN PROGRAM. Campaign.slug and Program.slug are each
 * unique on their own model but not against each other, so a slug that
 * happens to collide resolves to the Campaign -- a Campaign is the more
 * common Manual Contribution target (CONTEXT.md), and an Admin who meant
 * the Program can always search again once they see which one this found.
 */

type ResolvedTarget = { type: 'campaign' | 'program'; id: string; title: string } | null;

async function resolveTarget(slug: string): Promise<ResolvedTarget> {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, title: true },
  });
  if (campaign) {
    return { type: 'campaign', id: campaign.id, title: campaign.title };
  }

  const program = await prisma.program.findUnique({
    where: { slug },
    select: { id: true, title: true },
  });
  if (program) {
    return { type: 'program', id: program.id, title: program.title };
  }

  return null;
}

export default async function AdminNewManualContributionPage({ searchParams }: RouteContext) {
  const { q } = await searchParams;
  const resolved = q ? await resolveTarget(q) : undefined;

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Catat Manual Contribution</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cari Campaign atau Program dengan slug-nya, lalu catat uang yang masuk di luar payment gateway dengan bukti
          transfer.
        </p>
      </div>

      <form method="GET" className="mb-6 flex gap-2">
        <label className="sr-only" htmlFor="q">
          Slug Campaign atau Program
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q ?? ''}
          aria-label="Slug Campaign atau Program"
          placeholder="Slug Campaign atau Program"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
        />
        <button type="submit" className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white">
          Cari
        </button>
      </form>

      {resolved === null && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Tidak ditemukan Campaign maupun Program dengan slug tersebut.
        </p>
      )}

      {resolved && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">{resolved.type === 'campaign' ? 'Campaign' : 'Program'}</p>
          <p className="mb-4 text-lg font-semibold text-gray-900">{resolved.title}</p>

          <AdminManualContributionCreateForm target={{ type: resolved.type, id: resolved.id }} />
        </div>
      )}
    </div>
  );
}
