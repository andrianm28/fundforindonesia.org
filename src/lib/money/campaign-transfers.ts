import { CampaignStatus, Kind, type CampaignTransfer, type Prisma, type PrismaClient } from '@/generated/prisma/client';
import { OwnSubjectConflictError } from '@/lib/capacity';
import { lockAndLoad, requireNotOwnerAsAdmin, type SubjectState } from '@/lib/subject-guard';
import { readDonationGuestEmail, SELECT_DONATION_GUEST_EMAIL } from '@/lib/contact-fields';
import { getMailer, type Mailer } from '@/lib/mail';
import { campaignTransferEmail } from '@/lib/mail/campaign-transfer';
import { publicUrl } from '@/lib/public-url';
import { formatRupiah } from '@/lib/utils/currency';
import { KIND_LABEL } from '@/lib/campaign-kind';
import { campaignBalance, campaignTransferLegs, postTransaction } from './ledger';
import {
  CampaignTransferBalanceChangedError,
  CampaignTransferCategoryMismatchError,
  CampaignTransferCrossKindError,
  CampaignTransferInvalidError,
  CampaignTransferKindNotTransferableError,
  CampaignTransferNotFoundError,
  CampaignTransferNotPendingError,
  CampaignTransferSourceNotSuspendedError,
  CampaignTransferTargetNotEligibleError,
  DemoCampaignError,
  InsufficientBalanceError,
  SelfApprovalError,
} from './errors';

/**
 * Campaign Transfer (prd-compliance 33; csr-and-hibah 10; PRD §7.2; ADR 0015;
 * CONTEXT.md, Campaign Transfer): when a zakat, wakaf or hibah Campaign is Suspended its money is
 * not handed back to Donors, it moves to another Campaign of the same Kind.
 *
 * THE KIND RULES LIVE HERE, NOT IN A SCREEN. `judgeCampaignTransfer` is the
 * one place that decides whether money may move from one Campaign to another,
 * and it is called under both row locks at the request and again at the
 * approval, so a UI that offers a wrong target, or a request crafted by hand,
 * meets the same refusal. Zakat goes to zakat; wakaf goes to wakaf of the same
 * category; hibah goes to hibah; anything across Kinds is refused outright, never warned about. It
 * is a pure function of the two locked states so the Dormant Balance transfer
 * (a later ticket) can reuse it by judging its own source status.
 *
 * THE TWO-PERSON RULE, same shape as a Manual Contribution:
 *   request  one Admin. Posts nothing.
 *   approve  a DIFFERENT Admin. The only place money moves.
 *   reject   a different Admin, with a reason. Nothing was ever posted.
 *
 * THE JOURNAL. Approval posts one balanced transaction -- debit the source's
 * CAMPAIGN_BALANCE, credit the target's (campaignTransferLegs) -- keyed
 * `campaign-transfer-<id>` so a retry cannot post twice, on top of the status
 * claim. No balance is edited. Only the withdrawable Campaign Balance moves:
 * Escrow Hold still maturing stays with the source and is released by the
 * sweep after a lift; money frozen for a Refund (technical failure) stays
 * frozen. Neither Campaign's `collectedAmount` changes: that figure is what
 * Donors gave through Settlement and Manual Contribution, which the
 * reconciliation report rebuilds from the ledger, and a transfer is not a gift.
 *
 * LOCK ORDER. Both Campaigns are locked through the subject guard's
 * `lockAndLoad`, always in ascending id order whichever is the source, so two
 * transfers that cross (A to B and B to A) cannot deadlock. This is the same
 * subject-first rule escrow.ts and payouts.ts follow; no Payment is locked
 * here at all.
 *
 * ESCALATION CHOICE THAT WAITS FOR THE OWNER (recorded in the ticket): who
 * may approve is "any Admin other than the requester, who is not the
 * Fundraiser of either Campaign". The PRD names no one else, and this is the
 * pattern of Manual Contribution and Payout approval.
 *
 * A later transfer from the same source is allowed even after an APPROVED one
 * (Escrow Hold that matures afterwards moves the same way): nothing here or in
 * the schema limits a source to one transfer.
 *
 * Callers establish the ADMIN Capacity (the routes do, through
 * withAssignmentCheck); these commands take the acting id because they also
 * judge it against the requester and the two Campaigns' owners.
 */

export {
  CampaignTransferBalanceChangedError,
  CampaignTransferCategoryMismatchError,
  CampaignTransferCrossKindError,
  CampaignTransferInvalidError,
  CampaignTransferKindNotTransferableError,
  CampaignTransferNotFoundError,
  CampaignTransferNotPendingError,
  CampaignTransferSourceNotSuspendedError,
  CampaignTransferTargetNotEligibleError,
  DemoCampaignError,
  InsufficientBalanceError,
  OwnSubjectConflictError,
  SelfApprovalError,
};

const MAX_REASON_LENGTH = 1000;

/**
 * How each Kind's money is moved when its Campaign is Suspended (PRD §7.2;
 * ADR 0013, 0015). A total Record over Kind, like the refund table in
 * refunds.ts, so a fifth Kind cannot be added without someone deciding its
 * transfer rule here. Every transferable Kind goes only to its own Kind.
 *  - zakat: any zakat Campaign.
 *  - wakaf: a wakaf Campaign of the same Category (the asset stays bound).
 *  - hibah: any hibah Campaign (csr-and-hibah ticket 10). The Wakaf copy that
 *    ADR 0013 makes provisional covers Kind Authorisation, Refund and fee, not
 *    this; the ticket and spec say "the same Kind" only. OWNER DECISION
 *    PENDING: whether Hibah should also be category-bound like Wakaf.
 *  - donation: not transferred (its own rule).
 */
const TRANSFER_RULE_BY_KIND: Record<Kind, { transferable: boolean; sameCategory: boolean }> = {
  [Kind.DONATION]: { transferable: false, sameCategory: false },
  [Kind.ZAKAT]: { transferable: true, sameCategory: false },
  [Kind.WAKAF]: { transferable: true, sameCategory: true },
  [Kind.HIBAH]: { transferable: true, sameCategory: false },
};

type CampaignState = Extract<SubjectState, { kind: 'campaign' }>;

/** A locked Campaign together with the free-text category `lockAndLoad` does not carry. */
export type TransferParty = { state: CampaignState; category: string };

/**
 * Whether money may move from `source` to `target`. Pure: judges two locked
 * states and throws the refusal, in the order a person would want to hear it.
 * Does not judge the source's status, the balance or who is acting, which are
 * the caller's (a Suspension transfer and a Dormant Balance transfer differ
 * on exactly those).
 */
export function judgeCampaignTransfer(source: TransferParty, target: TransferParty): void {
  if (source.state.id === target.state.id) {
    throw new CampaignTransferTargetNotEligibleError('same_campaign');
  }
  const rule = TRANSFER_RULE_BY_KIND[source.state.campaignKind];
  if (!rule.transferable) {
    throw new CampaignTransferKindNotTransferableError(source.state.campaignKind);
  }
  if (target.state.campaignKind !== source.state.campaignKind) {
    throw new CampaignTransferCrossKindError(source.state.campaignKind, target.state.campaignKind);
  }
  if (rule.sameCategory && source.category !== target.category) {
    throw new CampaignTransferCategoryMismatchError(source.category, target.category);
  }
  if (target.state.isDemo) {
    throw new CampaignTransferTargetNotEligibleError('demo');
  }
  if (target.state.effectiveStatus !== CampaignStatus.ACTIVE) {
    throw new CampaignTransferTargetNotEligibleError('not_active');
  }
}

function cleanReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CampaignTransferInvalidError('Alasan wajib diisi.');
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new CampaignTransferInvalidError(`Alasan paling panjang ${MAX_REASON_LENGTH} karakter.`);
  }
  return trimmed;
}

function cleanId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CampaignTransferInvalidError(`${field} wajib diisi.`);
  }
  return value.trim();
}

type Judged = {
  source: TransferParty;
  target: TransferParty;
  targets: { sourceTitle: string; targetTitle: string; targetSlug: string; kindLabel: string };
  balance: number;
};

/**
 * Locks both Campaigns in ascending id order, then judges everything that can
 * change between a request and its approval: the source is still Suspended,
 * the Kinds still allow it, nobody acting owns either Campaign, and the source
 * still holds something to move. Returns the withdrawable balance as read
 * under the locks. Everything is read after the locks are taken.
 */
async function lockAndJudge(
  tx: Prisma.TransactionClient,
  params: { sourceId: string; targetId: string; actorId: string; atApproval?: boolean },
): Promise<Judged> {
  const { sourceId, targetId, actorId, atApproval } = params;
  const now = new Date();

  const states = new Map<string, SubjectState | null>();
  for (const id of [sourceId, targetId].sort()) {
    if (states.has(id)) continue;
    states.set(id, await lockAndLoad(tx, { type: 'campaign', campaignId: id }, now));
  }
  const sourceState = states.get(sourceId);
  const targetState = states.get(targetId);
  if (!sourceState || sourceState.kind !== 'campaign') {
    throw new CampaignTransferInvalidError('Campaign asal tidak ditemukan.');
  }
  if (!targetState || targetState.kind !== 'campaign') {
    throw new CampaignTransferInvalidError('Campaign tujuan tidak ditemukan.');
  }

  const rows = await tx.campaign.findMany({
    where: { id: { in: [sourceId, targetId] } },
    select: { id: true, category: true, title: true, slug: true },
  });
  const rowOf = (id: string) => rows.find((r) => r.id === id);
  const sourceRow = rowOf(sourceId);
  const targetRow = rowOf(targetId);
  if (!sourceRow || !targetRow) {
    throw new CampaignTransferInvalidError('Campaign asal atau tujuan tidak ditemukan.');
  }

  // Order: the Demo refusal says the source has no real money at all, so it
  // comes first; then the source's status; then who may touch it (the same
  // order Payout and Manual Contribution use), then where the money may go.
  if (sourceState.isDemo) throw new DemoCampaignError();
  if (sourceState.effectiveStatus !== CampaignStatus.SUSPENDED) {
    throw new CampaignTransferSourceNotSuspendedError(sourceState.effectiveStatus);
  }
  requireNotOwnerAsAdmin(sourceState, actorId);
  requireNotOwnerAsAdmin(targetState, actorId);

  const source = { state: sourceState, category: sourceRow.category };
  const target = { state: targetState, category: targetRow.category };
  judgeCampaignTransfer(source, target);

  // The amount is never an input: it is the whole withdrawable balance, read
  // here under both locks. An empty source has nothing to transfer.
  const balance = await campaignBalance(tx, sourceId);
  // At approval an empty source is just a changed balance (the caller compares
  // it with the requested amount), so the Admin gets the same reject-and-re-request answer.
  if (balance <= 0 && !atApproval) {
    throw new InsufficientBalanceError(
      1,
      balance,
      'Campaign asal tidak memiliki Campaign Balance yang bisa dialihkan.',
    );
  }

  return {
    source,
    target,
    targets: { sourceTitle: sourceRow.title, targetTitle: targetRow.title, targetSlug: targetRow.slug,
      kindLabel: KIND_LABEL[sourceState.campaignKind],
    },
    balance,
  };
}

/**
 * One Admin asks for a Suspended Campaign's money to move to another
 * Campaign. Posts nothing: until a second Admin approves, this is a claim. The amount is
 * computed here, never supplied: the whole withdrawable balance of the source.
 * Judged in full here as well as at approval, so a request that could never be
 * approved is refused now rather than left in the queue.
 */
export async function requestCampaignTransfer(
  tx: Prisma.TransactionClient,
  params: { sourceId: string; targetId: string; reason: string; requestedById: string },
): Promise<CampaignTransfer> {
  const sourceId = cleanId(params.sourceId, 'Campaign asal');
  const targetId = cleanId(params.targetId, 'Campaign tujuan');
  const reason = cleanReason(params.reason);

  const { balance } = await lockAndJudge(tx, { sourceId, targetId, actorId: params.requestedById });

  return tx.campaignTransfer.create({
    data: {
      sourceId,
      targetId,
      amount: balance,
      reason,
      requestedById: params.requestedById,
      status: 'PENDING',
    },
  });
}

type GuestEmailRow = { guestEmailCiphertext: string | null; guestEmailKeyId: string | null };

/** Seams for the email half of the notification, so a test need not touch SMTP or the field keys. */
export type CampaignTransferNotifyDeps = {
  mailer?: Mailer;
  readGuestEmail?: (row: GuestEmailRow) => string | null;
};

/**
 * A second Admin approves: the money moves, as one balanced journal, and every
 * affected Donor is told where it went.
 *
 * Shaped like approveManualContribution: read the record, refuse the
 * two-person breach before any write, lock and re-judge everything, claim the
 * status with a predicated update, only then post. In-app notifications (the
 * registered Donors of the source, and both Fundraisers) are written in the
 * same transaction, so a transfer cannot commit without them. Guest Donors
 * have no inbox and are emailed after the commit, best effort: a mail outage
 * is logged and never undoes a transfer that has already happened.
 */
export async function approveCampaignTransfer(
  prisma: PrismaClient,
  params: { campaignTransferId: string; decidedById: string },
  deps: CampaignTransferNotifyDeps = {},
): Promise<CampaignTransfer> {
  const { campaignTransferId, decidedById } = params;

  const outcome = await prisma.$transaction(async (tx) => {
    const record = await tx.campaignTransfer.findUnique({ where: { id: campaignTransferId } });
    if (!record) throw new CampaignTransferNotFoundError(campaignTransferId);

    // The entire two-person rule, checked before any write.
    if (record.requestedById === decidedById) throw new SelfApprovalError('Campaign Transfer');
    if (record.status !== 'PENDING') throw new CampaignTransferNotPendingError(record.status);

    const judged = await lockAndJudge(tx, {
      sourceId: record.sourceId,
      targetId: record.targetId,
      actorId: decidedById,
      atApproval: true,
    });

    // FULL TRANSFER ONLY. The amount was fixed at the request as the whole
    // withdrawable balance; here it is recomputed under the locks. If the two
    // differ (a Payout or Refund drained it, or a late Settlement added to it)
    // the safest behaviour is to refuse and move nothing: moving the old
    // figure could overdraw or strand money, and silently moving the new one
    // would approve a sum the first Admin never saw. The transfer stays
    // PENDING; the Admin rejects it and files a fresh request, which captures
    // the current balance.
    if (judged.balance !== record.amount) {
      throw new CampaignTransferBalanceChangedError(record.amount, judged.balance);
    }

    const claimed = await tx.campaignTransfer.updateMany({
      where: { id: campaignTransferId, status: 'PENDING' },
      data: { status: 'APPROVED', decidedById, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw new CampaignTransferNotPendingError('unknown (changed concurrently)');

    await postTransaction(
      tx,
      campaignTransferLegs({
        sourceCampaignId: record.sourceId,
        targetCampaignId: record.targetId,
        amount: record.amount,
      }),
      { campaignTransferId: record.id, transactionId: `campaign-transfer-${record.id}` },
    );

    const donors = await tx.donation.findMany({
      where: { campaignId: record.sourceId, paymentStatus: 'confirmed', donorId: { not: null } },
      select: { donorId: true },
      distinct: ['donorId'],
    });
    const message = (audience: 'donor' | 'fundraiser') =>
      audience === 'donor'
        ? `Campaign "${judged.targets.sourceTitle}" yang Anda dukung sedang Suspended. Dana yang terkumpul tidak dikembalikan, ` +
          `melainkan dialihkan ke Campaign "${judged.targets.targetTitle}" dengan Kind yang sama.`
        : `${formatRupiah(record.amount)} dari Campaign "${judged.targets.sourceTitle}" dialihkan ke Campaign ` +
          `"${judged.targets.targetTitle}" karena Campaign asal sedang Suspended.`;
    const link = `/campaign/${judged.targets.targetSlug}`;
    const recipients = new Map<string, 'donor' | 'fundraiser'>();
    for (const d of donors) if (d.donorId) recipients.set(d.donorId, 'donor');
    recipients.set(judged.source.state.ownerId, 'fundraiser');
    recipients.set(judged.target.state.ownerId, 'fundraiser');
    await tx.notification.createMany({
      data: Array.from(recipients, ([userId, audience]) => ({
        type: 'campaign_transfer',
        title: audience === 'donor' ? 'Dana Anda Dialihkan' : 'Dana Campaign Dialihkan',
        message: message(audience),
        userId,
        link,
      })),
    });

    const guests = await tx.donation.findMany({
      where: { campaignId: record.sourceId, paymentStatus: 'confirmed', donorId: null },
      select: SELECT_DONATION_GUEST_EMAIL,
    });
    return { targets: judged.targets, guests: guests as GuestEmailRow[] };
  });

  await emailGuestDonors(outcome.guests, outcome.targets, deps);

  return prisma.campaignTransfer.findUniqueOrThrow({ where: { id: campaignTransferId } });
}

async function emailGuestDonors(
  guests: GuestEmailRow[],
  targets: { sourceTitle: string; targetTitle: string; targetSlug: string; kindLabel: string },
  deps: CampaignTransferNotifyDeps,
): Promise<void> {
  const read = deps.readGuestEmail ?? readDonationGuestEmail;
  const addresses = new Set<string>();
  for (const guest of guests) {
    // An anonymised Donation has had its contact cleared (ticket 36): nothing to send to.
    const address = guest.guestEmailCiphertext ? read(guest) : null;
    if (address) addresses.add(address);
  }
  if (addresses.size === 0) return;

  const mailer = deps.mailer ?? getMailer();
  for (const to of addresses) {
    try {
      await mailer.send(
        campaignTransferEmail({
          to,
          sourceTitle: targets.sourceTitle,
          targetTitle: targets.targetTitle,
          targetUrl: publicUrl(`/campaign/${targets.targetSlug}`),
          kindLabel: targets.kindLabel,
        }),
      );
    } catch (error) {
      console.error('Campaign Transfer: could not email a Guest Donor', error);
    }
  }
}

/**
 * A second Admin declines. Nothing is posted, because nothing was ever
 * posted; the record stays, because closing a queue entry is a decision.
 *
 * DELIBERATELY NO SUBJECT LOCK. Rejecting moves no money and reads no balance
 * or Campaign state, so there is nothing a Campaign lock would protect. The
 * only race is two decisions on one transfer, and that is settled by the
 * predicated `updateMany` on `status: 'PENDING'` below: exactly one claim wins
 * and the loser gets CampaignTransferNotPendingError, whichever way the other
 * decision (approve or reject) went. Approval takes the locks because it spends.
 */
export async function rejectCampaignTransfer(
  prisma: PrismaClient,
  params: { campaignTransferId: string; decidedById: string; reason: string },
): Promise<CampaignTransfer> {
  const { campaignTransferId, decidedById } = params;
  const reason = cleanReason(params.reason);

  await prisma.$transaction(async (tx) => {
    const record = await tx.campaignTransfer.findUnique({ where: { id: campaignTransferId } });
    if (!record) throw new CampaignTransferNotFoundError(campaignTransferId);
    if (record.requestedById === decidedById) throw new SelfApprovalError('Campaign Transfer');
    if (record.status !== 'PENDING') throw new CampaignTransferNotPendingError(record.status);

    const claimed = await tx.campaignTransfer.updateMany({
      where: { id: campaignTransferId, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById, decidedAt: new Date(), decisionReason: reason },
    });
    if (claimed.count === 0) throw new CampaignTransferNotPendingError('unknown (changed concurrently)');
  });

  return prisma.campaignTransfer.findUniqueOrThrow({ where: { id: campaignTransferId } });
}
