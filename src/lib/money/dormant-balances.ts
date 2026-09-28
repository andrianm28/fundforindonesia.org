import { CampaignStatus, type PrismaClient } from '@/generated/prisma/client';
import { effectiveStatus } from '@/lib/campaign-lifecycle';

/**
 * The 60-day Dormant Balance report (ticket 24; PRD §7.3, CONTEXT.md
 * "Dormant Balance"). PRD §7.3: "Campaign yang Expired atau Completed dan
 * masih memegang Campaign Balance muncul di laporan Admin setelah 60 hari."
 *
 * Report only. The PRD's own next sentence -- reallocating that balance to
 * another Campaign after 180 days and three reminders -- is explicitly out
 * of Rilis 1 (CONTEXT.md, `.scratch/rilis-1-benda/issues/24-dormant-60-day-report.md`)
 * and nothing here does it: this module only reads and lists.
 *
 * Read-only over money: every figure comes from the ledger
 * (src/lib/money/ledger.ts's own campaignBalance, inlined here as a
 * `groupBy` over many Campaigns at once rather than one query per Campaign,
 * the same batching src/lib/money/impact.ts uses), and nothing in this file
 * writes a LedgerEntry, a Payout, or any other money row.
 */
export const DORMANT_BALANCE_REPORT_THRESHOLD_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DormantBalanceRow {
  campaignId: string;
  slug: string;
  title: string;
  /** The effective status this Campaign has held since `since` (subject.md, effectiveStatus). */
  status: 'EXPIRED' | 'COMPLETED';
  /**
   * When this Campaign entered that status. For COMPLETED, always the
   * recorded CampaignStatusChange (a Campaign cannot become Completed any
   * other way). For EXPIRED, the recorded transition when one exists, or
   * else the deadline itself: `effectiveStatus` treats an ACTIVE Campaign
   * past its deadline as EXPIRED whether or not anyone has recorded that
   * yet (src/lib/subject-guard.ts), and the deadline is the honest date it
   * became so -- not "now", which would hide it from this report until
   * someone else's unrelated action happens to record the transition.
   */
  since: Date;
  daysSince: number;
  /** Campaign Balance in rupiah, always > 0 here: a Campaign at zero has nothing dormant to report. */
  balance: number;
}

const REPORTABLE_STATUSES = [CampaignStatus.ACTIVE, CampaignStatus.EXPIRED, CampaignStatus.COMPLETED] as const;
const SINCE_STATUSES = [CampaignStatus.EXPIRED, CampaignStatus.COMPLETED] as const;

export async function dormantBalanceReport(
  db: PrismaClient,
  now: Date = new Date(),
  thresholdDays: number = DORMANT_BALANCE_REPORT_THRESHOLD_DAYS,
): Promise<DormantBalanceRow[]> {
  return db.$transaction(async (tx) => {
    // ACTIVE is included here only so an ACTIVE-but-past-deadline row (not
    // yet recorded EXPIRED) is caught by effectiveStatus below -- the same
    // lazy-expiry gap campaignAcceptsDonations and expireIfPastDeadline
    // already live with (src/lib/campaign-lifecycle.ts).
    const campaigns = await tx.campaign.findMany({
      where: { isDemo: false, lifecycleStatus: { in: [...REPORTABLE_STATUSES] } },
      select: { id: true, slug: true, title: true, lifecycleStatus: true, deadline: true },
    });

    const candidates = campaigns
      .map((campaign) => ({ campaign, effective: effectiveStatus(campaign, now) }))
      .filter(
        (row): row is { campaign: typeof row.campaign; effective: 'EXPIRED' | 'COMPLETED' } =>
          row.effective === CampaignStatus.EXPIRED || row.effective === CampaignStatus.COMPLETED,
      );

    if (candidates.length === 0) return [];

    const campaignIds = candidates.map(({ campaign }) => campaign.id);

    // Latest recorded transition into EXPIRED or COMPLETED, per Campaign.
    // Ordered so the first row kept per campaignId is the most recent one --
    // a Campaign lifted from Suspended back through Expired, or re-opened by
    // any future flow, must report the most recent entry into the status,
    // not the first one it ever had.
    const transitions = await tx.campaignStatusChange.findMany({
      where: { campaignId: { in: campaignIds }, toStatus: { in: [...SINCE_STATUSES] } },
      select: { campaignId: true, toStatus: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const sinceByCampaign = new Map<string, Date>();
    for (const transition of transitions) {
      if (!sinceByCampaign.has(transition.campaignId)) {
        sinceByCampaign.set(transition.campaignId, transition.createdAt);
      }
    }

    // Every campaign-scoped CAMPAIGN_BALANCE leg for every candidate, in one
    // query rather than one campaignBalance() call per row (src/lib/money/
    // impact.ts's own batching, for the same reason).
    const balanceRows = await tx.ledgerEntry.groupBy({
      by: ['campaignId', 'direction'],
      where: { account: 'CAMPAIGN_BALANCE', campaignId: { in: campaignIds } },
      _sum: { amount: true },
    });
    const balances = new Map<string, number>();
    for (const row of balanceRows) {
      if (!row.campaignId) continue;
      const signed = row.direction === 'CREDIT' ? (row._sum.amount ?? 0) : -(row._sum.amount ?? 0);
      balances.set(row.campaignId, (balances.get(row.campaignId) ?? 0) + signed);
    }

    const rows: DormantBalanceRow[] = [];
    for (const { campaign, effective } of candidates) {
      const balance = balances.get(campaign.id) ?? 0;
      if (balance <= 0) continue;

      const since = sinceByCampaign.get(campaign.id) ?? campaign.deadline;
      if (!since) continue; // Cannot happen: COMPLETED always has a transition, EXPIRED always has a deadline.

      const daysSince = Math.floor((now.getTime() - since.getTime()) / MS_PER_DAY);
      if (daysSince < thresholdDays) continue;

      rows.push({
        campaignId: campaign.id,
        slug: campaign.slug,
        title: campaign.title,
        status: effective,
        since,
        daysSince,
        balance,
      });
    }

    rows.sort((a, b) => b.daysSince - a.daysSince);
    return rows;
  });
}
