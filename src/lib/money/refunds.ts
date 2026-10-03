import { timingSafeEqual } from 'node:crypto';
import { Kind, type Payment, type Prisma, type PrismaClient, type Refund } from '@/generated/prisma/client';
import { OwnSubjectConflictError } from '@/lib/capacity';
import { lockAndLoad, requireNotOwnerAsAdmin } from '@/lib/subject-guard';
import { validateProofReference, validateProofNote, buildProofImage } from '@/lib/payout-proof';
import { sealRefundDonorAccountNumber, readRefundDonorAccountNumber } from '@/lib/contact-fields';
import {
  campaignBalance,
  tripBalance,
  escrowBalance,
  tripEscrowBalance,
  postTransaction,
  refundRequestedLegs,
  refundFreezeTransactionId,
  refundFreezeDebit,
  refundApprovedLegs,
  refundPaidLegs,
  reverseEntriesLegs,
  escrowReleaseLegs,
  providerFeePortionFor,
  platformFeePortionFor,
  type LedgerSubject,
  type StandingRefundFees,
} from './ledger';
import {
  DemoCampaignError,
  DonationAnonymisedError,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
  RefundNotAllowedForKindError,
  RefundNotFoundError,
  RefundProofInvalidError,
  RefundDestinationInvalidError,
  RefundDestinationMismatchError,
  SelfApprovalError,
  InvalidRefundStatusError,
  RefundFreezeJournalMissingError,
  TwoPersonRuleError,
  RefundAfterCampaignTransferError,
  RefundResolutionActorError,
  RefundReasonInvalidError,
} from './errors';
import { STANDING_REFUND_WHERE, isRefundStanding, readRefundFreezeEntries } from './refund-standing';

/**
 * Refund: request, approve, complete.
 *
 * Ported from the same two-person disbursement discipline as
 * src/lib/money/payouts.ts, generalized over subject: LedgerSubject from
 * day one (see the spec's own User Story 11) rather than forked into a
 * Trip-scoped sibling later.
 *
 * Ticket 23's code only ever produced REQUESTED and APPROVED. Ticket 31
 * adds `completeRefund`, APPROVED -> COMPLETED, with the transfer proof
 * CONTEXT.md's Refund entry calls for. The remaining three statuses
 * (AwaitingDonorDetails, Processing -- Processing is subsumed into this one
 * completion step, same as Payout -- Rejected, Failed) and the signed
 * 30-day donor-details link still stay in the schema's enum for a later
 * rilis, deferred by the same owner decision that scoped ticket 23.
 *
 * OWNER DECISION Q7(c), 2026-09-28 (ADR 0018 Amendment 2026-09-28): ADR
 * 0018 wants a Refund's destination to be a Verifier-checked Bank Account,
 * same as a Payout's, but Rilis 1's Guest Donors have no account to hold
 * one on. The compensating control is two pairs of eyes on the account
 * number instead of a Verifier's: the Admin who APPROVES a Refund records
 * the destination from the Donor's written request (moved here from
 * completion, where ticket 31 first put it), and the different Admin who
 * COMPLETES it re-types the account number, which the server compares
 * against the sealed one recorded at approval -- never the bank code or
 * the account name, only the number, because that is the one field a
 * misread digit sends money to the wrong stranger. `completeRefund` no
 * longer accepts a destination of its own, only the re-typed number to
 * check.
 */

export {
  DemoCampaignError,
  OwnSubjectConflictError,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
  RefundNotAllowedForKindError,
  RefundNotFoundError,
  RefundProofInvalidError,
  RefundDestinationInvalidError,
  RefundDestinationMismatchError,
  SelfApprovalError,
  InvalidRefundStatusError,
  RefundFreezeJournalMissingError,
  TwoPersonRuleError,
  RefundAfterCampaignTransferError,
  RefundResolutionActorError,
  RefundReasonInvalidError,
};

type PaymentWithSubjectLinks = Pick<Payment, 'amount' | 'providerFee' | 'platformFee' | 'escrowReleasedAt'> & {
  donation: { campaignId: string; anonymisedAt: Date | null } | null;
  registration: { batch: { tripId: string } } | null;
};

/**
 * Which Campaign-or-Trip a Payment belongs to, read off whichever of
 * donation/registration is actually set -- the same derivation
 * src/lib/money/escrow.ts already uses for the identical purpose.
 */
function paymentSubjectOf(payment: PaymentWithSubjectLinks): LedgerSubject {
  return payment.donation
    ? { type: 'campaign', campaignId: payment.donation.campaignId }
    : { type: 'trip', tripId: payment.registration!.batch.tripId };
}

function sameSubject(a: LedgerSubject, b: LedgerSubject): boolean {
  if (a.type !== b.type) return false;
  return a.type === 'campaign'
    ? a.campaignId === (b as { campaignId: string }).campaignId
    : a.tripId === (b as { tripId: string }).tripId;
}

/**
 * ESCROW_HOLD while the Payment's escrow hasn't matured, the subject's
 * withdrawable balance once it has. Re-derived fresh at both createRefund
 * and approveRefund time -- escrow can mature in the window between the
 * two, and each call cares about where the pool sits right now, not where
 * it sat when the other call ran.
 */
function sourceFor(
  payment: Pick<Payment, 'escrowReleasedAt'>,
  subject: LedgerSubject,
): 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE' {
  if (payment.escrowReleasedAt == null) return 'ESCROW_HOLD';
  return subject.type === 'campaign' ? 'CAMPAIGN_BALANCE' : 'TRIP_BALANCE';
}

async function poolBalanceFor(
  tx: Prisma.TransactionClient,
  subject: LedgerSubject,
  source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE',
): Promise<number> {
  if (source === 'ESCROW_HOLD') {
    return subject.type === 'campaign' ? escrowBalance(tx, subject.campaignId) : tripEscrowBalance(tx, subject.tripId);
  }
  return subject.type === 'campaign' ? campaignBalance(tx, subject.campaignId) : tripBalance(tx, subject.tripId);
}

/**
 * What a Refund may be for, per Campaign Kind (PRD §196; ADR 0013).
 *
 * A total Record over Kind rather than a list of the restricted Kinds, so a
 * fifth Kind cannot be added without someone deciding its refund rule here:
 * the table IS the rule, and the compiler is what forces the decision. Zakat,
 * Wakaf and Hibah read one and the same entry, because Hibah's rule is
 * Wakaf's copied as a stated placeholder (ADR 0013), not a rule of its own.
 * A Volunteer Trip is absent from the table on purpose: it has no Kind, and
 * its Refunds are Batch cancellations, which is a different rule entirely
 * (./volunteer/refunds.ts).
 *
 * A Kind that is somehow not in the table reads as undefined, which is not
 * 'ordinary' and so is REFUSED. The column is not nullable, so this cannot
 * happen through the database -- but the direction to fail in, if it ever
 * did, is the one that keeps the money.
 */
const REFUND_ELIGIBILITY_BY_KIND: Record<Kind, 'ordinary' | 'technical failure only'> = {
  [Kind.DONATION]: 'ordinary',
  [Kind.ZAKAT]: 'technical failure only',
  [Kind.WAKAF]: 'technical failure only',
  [Kind.HIBAH]: 'technical failure only',
};

/**
 * The three failures PRD §196 calls the only ones a Refund on a zakat, Wakaf
 * or Hibah Campaign may be for, quoted from that sentence rather than phrased
 * here: wrong payment, double payment, and funds that arrived after the
 * Campaign closed. They are reasons, not a controlled vocabulary the caller
 * picks from -- see the note on requireRefundAllowedForKind for what that
 * costs, and what closing it would need.
 */
const TECHNICAL_FAILURE_REASONS = [
  'salah bayar',
  'bayar ganda',
  'dana masuk setelah Campaign ditutup',
] as const;

/**
 * Whether this Campaign's Kind returns a Donor their money on an ordinary
 * request, or only when something technical went wrong (PRD §196; ADR 0013).
 *
 * The reason is compared as a whole, trimmed, ignoring case -- equality, never
 * a substring, a keyword or a fuzzy match. That direction is the whole point:
 * a gate that looks for a word *inside* free text is passed by any sentence
 * that happens to contain it, a misspelling of it included, which is the class
 * of bug this rule exists to stop. Equality can only refuse more, never let
 * more through, and trimming/case are the only leniency, so that a capital
 * letter or a stray space does not refuse a genuine technical failure.
 *
 * WHAT THIS IS NOT. `Refund.reason` is a free-text column, and the only actor
 * who reaches this is an Admin typing into it, so these three phrases are a
 * claim the Admin makes and the Platform believes, not a fact the Platform
 * establishes: an Admin who wants a zakat refund can write "salah bayar" and
 * pass. So this stops an ordinary request going through by accident, by
 * copy-paste, or by a rule that was never implemented at all -- which is the
 * state this repository was in -- and it does not stop one by intent. Closing
 * that needs a structured reason: an enum the Admin chooses, or one derived
 * from facts about the Payment itself (a second charge with the same
 * providerRef, a settlement received after the Campaign closed). That is a
 * design decision this fix does not make, because `reason` is free text in the
 * schema, the API and any Admin screen, and turning it into one is a migration
 * with its own open questions: what to do with the Refunds already recorded,
 * which reason each carries today, and who is allowed to pick which.
 */
function requireRefundAllowedForKind(campaignKind: Kind, reason: string): void {
  if (REFUND_ELIGIBILITY_BY_KIND[campaignKind] === 'ordinary') return;
  const stated = reason.trim().toLowerCase();
  if (TECHNICAL_FAILURE_REASONS.some((allowed) => allowed.toLowerCase() === stated)) return;
  throw new RefundNotAllowedForKindError(campaignKind, TECHNICAL_FAILURE_REASONS);
}

/**
 * What each of these Refunds, all still standing on one Payment, took of the
 * Platform Fee and the Provider Fee: read back off the entries its freeze posted
 * (refundFreezeDebit, ./ledger.ts), the same reading approveRefund and the
 * escrow sweep make, rather than worked out again from the amounts.
 *
 * A Refund's share is fixed once, against the Refunds that stood when it was
 * frozen. Rejecting or failing one of those afterwards (prd-compliance 49) does
 * not move the shares the others already carry, so the next Refund's share has to
 * be measured against what is posted, or the standing Refunds stop adding up to
 * the Payment's fee (prd-compliance 53).
 *
 * With no Refund standing nothing is read: most Payments never see one. A Refund
 * whose freeze journal is not there is refused, not counted as having taken
 * nothing, for the same reason the sweep and approveRefund refuse it: createRefund
 * posts the journal in the same transaction as the Refund row, so it cannot be
 * missing in normal operation, and guessing would put the wrong share on the next
 * Refund. Read ahead of the Refund row, so the refusal writes nothing.
 */
async function standingRefundFees(
  tx: Prisma.TransactionClient,
  standing: ReadonlyArray<{ id: string; amount: number }>,
): Promise<StandingRefundFees[]> {
  const entries = await readRefundFreezeEntries(
    tx,
    standing.map((r) => r.id),
  );

  return standing.map((r) => ({
    amount: r.amount,
    platformFeePosted: refundFreezeDebit(entries, r.id, 'PLATFORM_FEE'),
    providerFeePosted: refundFreezeDebit(entries, r.id, 'REFUND_COST'),
  }));
}

/**
 * An Admin creates a Refund for a Payment. Locks the subject (Campaign or
 * VolunteerTrip) BEFORE the Payment row, matching the Campaign/VolunteerTrip
 * -> Payment order this codebase's other money-moving transactions already
 * use (releaseMaturedEscrow, approvePayout) -- locking Payment first here
 * would reintroduce the deadlock class that ordering exists to prevent, if
 * this ever races the escrow sweep on the same matured-but-not-yet-released
 * Payment. The Payment lock itself is still what makes the cumulative-
 * refund-cap check below safe: two concurrent createRefund calls against
 * two DIFFERENT Payments on the same Campaign do not contend on it at all,
 * but two against the SAME Payment must not both read the same
 * prior-refunds sum and both pass the cap before either commits.
 *
 * Unlike requestPayout (which posts nothing at request time), this
 * immediately posts the freeze in the same transaction -- the PRD's
 * "seketika" requirement: a Campaign or Trip must not be able to spend
 * money that is already earmarked for return. The Provider Fee (and
 * Platform Fee) portion is split out right here, at freeze time -- see
 * refundRequestedLegs (./ledger.ts) for why deferring it to settlement was
 * wrong.
 */
export async function createRefund(
  tx: Prisma.TransactionClient,
  params: {
    subject: LedgerSubject;
    paymentId: string;
    amount: number;
    reason: string;
    requestedById: string;
  },
): Promise<Refund> {
  const { subject, paymentId, amount, reason, requestedById } = params;

  const subjectState = await lockAndLoad(tx, subject, new Date());

  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  if (lockedRows.length === 0) {
    throw new PaymentNotFoundError(paymentId);
  }

  const payment = (await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { donation: true, registration: { include: { batch: true } } },
  })) as unknown as PaymentWithSubjectLinks & { id: string };

  const paymentSubject = paymentSubjectOf(payment);
  if (!sameSubject(subject, paymentSubject)) {
    throw new PaymentSubjectMismatchError(paymentId);
  }

  // Ticket 36: read under the Payment lock taken above, the same lock
  // anonymiseDonations takes, so an anonymisation and a Refund on one
  // Donation cannot both succeed.
  if (payment.donation?.anonymisedAt) {
    throw new DonationAnonymisedError();
  }

  if (subjectState?.kind === 'campaign') {
    if (subjectState.isDemo) {
      throw new DemoCampaignError();
    }
    // Only Campaign subjects: every Trip-subject caller creates the Refund
    // as the Trip's Fundraiser (Batch cancellation), the Volunteer, or the
    // settlement webhook -- never in an Admin capacity.
    requireNotOwnerAsAdmin(subjectState, requestedById);
    // The Kind's own Refund rule, judged on the row lockAndLoad already read:
    // `kind` is one of its columns, so this costs no extra read and cannot be
    // stepped around by a caller that simply forgets to ask -- a Trip-subject
    // Refund never reaches here, and a Campaign-subject one cannot skip it.
    requireRefundAllowedForKind(subjectState.campaignKind, reason);
  }

  const priorRefunds = await tx.refund.findMany({
    where: { paymentId, ...STANDING_REFUND_WHERE },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, status: true },
  });
  const standingRefunds = priorRefunds.filter(isRefundStanding);
  const alreadyCommitted = standingRefunds.reduce((sum, r) => sum + r.amount, 0);
  const remaining = payment.amount - alreadyCommitted;
  if (amount > remaining) {
    throw new RefundExceedsRemainingError(amount, remaining);
  }

  const source = sourceFor(payment, subject);
  // Split proportional to amount / payment.amount, capped cumulatively across
  // every Refund still standing on this Payment (prd-compliance 17). The
  // Payment's pool only ever held gross - providerFee - platformFee
  // (paymentSettledLegs), so a Refund must return this share too, not just the
  // Provider Fee's. What those Refunds already took is READ off the freezes
  // they posted, not worked out again from their amounts (prd-compliance 53).
  const standingFees = await standingRefundFees(tx, standingRefunds);
  const platformFeePortion = platformFeePortionFor(payment, amount, standingFees);
  const providerFeePortion = providerFeePortionFor(payment, amount, standingFees);
  // The freeze below DEBITS the Campaign's withdrawable balance by the net
  // portion at request time. A pool a Payout drew down is covered by the
  // platform at approval (shortfall), but a pool a Campaign Transfer moved
  // away is not: that money sits on another Campaign. So, under the Campaign
  // lock taken above (the same lock approveCampaignTransfer holds while it
  // moves the balance; it takes no Payment lock, so no cycle), a Refund that
  // the balance cannot cover is refused when an APPROVED transfer left this
  // Campaign. Escrow Hold, Trip pools and Payout shortfall are unchanged.
  if (source === 'CAMPAIGN_BALANCE' && subject.type === 'campaign') {
    const netToFreeze = amount - platformFeePortion - providerFeePortion;
    if (netToFreeze > 0) {
      const available = await campaignBalance(tx, subject.campaignId);
      if (available < netToFreeze) {
        const movedOut = await tx.campaignTransfer.count({ where: { sourceId: subject.campaignId, status: 'APPROVED' } });
        if (movedOut > 0) throw new RefundAfterCampaignTransferError(netToFreeze, available);
      }
    }
  }

  const refund = await tx.refund.create({
    data: { paymentId, amount, reason, requestedById, status: 'REQUESTED' },
  });

  // No claim on the Refund row here, unlike approveRefund: this Refund was
  // created a statement ago, so its id has never been posted. That is what
  // makes the transactionId below one-shot -- the ledger's claim index
  // (LedgerEntry_transactionId_claim_key, prd-compliance 28b) refuses it if
  // anything ever tries to freeze the same Refund twice.
  await postTransaction(
    tx,
    refundRequestedLegs({ subject, amount, source, platformFeePortion, providerFeePortion }),
    { refundId: refund.id, transactionId: refundFreezeTransactionId(refund.id) },
  );

  return refund;
}

const MAX_DESTINATION_TEXT_LENGTH = 200;

/**
 * The Donor destination's own field rule (ticket 31; Q7(c)): required,
 * trimmed, and bounded the same way createBankAccount's `cleanText`
 * (src/lib/bank-account-verification.ts) already bounds a saved
 * BankAccount's fields -- not a reuse of that function, because it throws
 * InvalidBankAccountError for a row this is not one of, but the same rule,
 * mirrored, so a Donor's hand-typed destination is judged no more loosely
 * than a Fundraiser's saved one.
 */
function cleanDestinationText(
  raw: unknown,
  label: string,
  field: 'donorBankCode' | 'donorAccountName' | 'donorAccountNumber',
): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    throw new RefundDestinationInvalidError(`${label} wajib diisi.`, field);
  }
  if (text.length > MAX_DESTINATION_TEXT_LENGTH) {
    throw new RefundDestinationInvalidError(`${label} maksimal ${MAX_DESTINATION_TEXT_LENGTH} karakter.`, field);
  }
  return text;
}

/**
 * Everything but the digits, so "1234-5678" and "1234 5678" and "12345678"
 * all compare equal: the Admin re-typing the number at completion is not
 * asked to reproduce the exact punctuation the approving Admin happened to
 * type, only the same digits (Q7(c)).
 */
function normalisedAccountDigits(raw: string): string {
  return raw.replace(/\D+/g, '');
}

/**
 * Constant-time comparison of two account numbers' digits (Q7(c)): the
 * re-typed number at completion against the one decrypted from the sealed
 * ciphertext recorded at approval. `timingSafeEqual` refuses two buffers of
 * different length outright, so an early, non-constant-time length check
 * would leak nothing a length-mismatch call does not already leak by
 * throwing -- there is no secret in how many digits a bank account number
 * has, only in which digits they are.
 */
function accountNumbersMatch(typed: string, recorded: string): boolean {
  const a = Buffer.from(normalisedAccountDigits(typed), 'utf8');
  const b = Buffer.from(normalisedAccountDigits(recorded), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * A different Admin approves a REQUESTED Refund: posts the gross-
 * recognition settlement, records the Donor's destination, and lands on
 * APPROVED. See refundApprovedLegs (./ledger.ts) for the exact debit/credit
 * math -- it closes FROZEN_BALANCE in full and, only for a genuine
 * shortfall (the fee was already handled at freeze time, never here), tops
 * the pool back up.
 *
 * THE DESTINATION MOVES HERE FROM COMPLETION (Q7(c), ADR 0018 Amendment
 * 2026-09-28). ADR 0018 wants a Refund's destination to be a
 * Verifier-checked Bank Account, same as a Payout's; Rilis 1's Guest
 * Donors have no account to hold one on, so the compensating control is
 * two pairs of eyes on the account number. This Admin is the first pair:
 * they read the Donor's written request and type the bank code, the
 * account holder name, and the account number here, before any money has
 * moved -- an approval with no destination is refused
 * (RefundDestinationInvalidError), through the same `cleanDestinationText`
 * completion used to ask for it in ticket 31's first cut. The number is
 * sealed immediately (`sealRefundDonorAccountNumber`, @/lib/contact-
 * fields.ts, ADR 0012) and never rendered back in full -- the completing
 * Admin's job is to re-type it from the same written request, not to read
 * it off this screen.
 */
export async function approveRefund(
  prisma: PrismaClient,
  params: {
    refundId: string;
    approvedById: string;
    donorBankCode: string;
    donorAccountName: string;
    donorAccountNumber: string;
  },
): Promise<Refund> {
  const { refundId, approvedById, donorBankCode, donorAccountName, donorAccountNumber } = params;

  // Checked before the transaction opens, mirroring completeRefund's own
  // proof check: a blank or over-length field can never become a good one
  // by reading the database, so an approval with no destination never
  // reaches a write.
  const cleanBankCode = cleanDestinationText(donorBankCode, 'Kode bank', 'donorBankCode');
  const cleanAccountName = cleanDestinationText(donorAccountName, 'Nama pemilik rekening', 'donorAccountName');
  const cleanAccountNumber = cleanDestinationText(donorAccountNumber, 'Nomor rekening', 'donorAccountNumber');
  const sealedAccountNumber = sealRefundDonorAccountNumber(cleanAccountNumber);

  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: { include: { donation: true, registration: { include: { batch: true } } } },
      },
    });
    if (!refund) {
      throw new RefundNotFoundError(refundId);
    }

    if (refund.requestedById === approvedById) {
      throw new SelfApprovalError('Refund');
    }

    const payment = refund.payment as unknown as PaymentWithSubjectLinks;
    const subject = paymentSubjectOf(payment);

    // Locks the subject, not the Refund row: the contended resource for the
    // shortfall computation below is the subject's pool, and a second,
    // different Refund against the same subject approved concurrently must
    // be serialised here, exactly mirroring approvePayout's own Campaign/
    // VolunteerTrip lock. Its owner is read under that lock, not before it.
    const subjectState = await lockAndLoad(tx, subject, new Date());

    // Approval is always an Admin act, so it is refused to the Campaign's
    // or the Trip's own Fundraiser.
    if (subjectState) requireNotOwnerAsAdmin(subjectState, approvedById);

    if (refund.status !== 'REQUESTED') {
      throw new InvalidRefundStatusError(refund.status);
    }

    const source = sourceFor(payment, subject);
    const poolBalance = await poolBalanceFor(tx, subject, source);

    // This Refund's own fee shares, READ off the freeze createRefund posted,
    // not worked out again. createRefund split the Refund against the Refunds
    // that stood before it at that moment (prd-compliance 17); a Refund
    // rejected or failed since is no longer in the set a recomputation would
    // use, so the second of two Refunds opened together, which carries the
    // share the cumulative cap cut, would get the larger uncapped share back,
    // and the shortfall below came out a rupiah or two short of what its
    // freeze took from the pool (prd-compliance 51). The escrow sweep reads
    // the same entries for the same reason (refundFreezeDebit, ./ledger.ts).
    // The net portion is what is left of the amount once those two shares are
    // taken off: the freeze's own pool leg sits on whichever account was the
    // source when it was posted, while the fee legs sit on accounts named for
    // what they are, so this reads the same whichever pool that was.
    //
    // A Refund with no freeze journal is refused, not counted as having taken
    // nothing: createRefund posts it in the same transaction as the Refund
    // row, so it cannot be missing in normal operation, and guessing would
    // cover the wrong shortfall. Read ahead of the claim below, so the refusal
    // leaves the Refund REQUESTED and writes nothing.
    const freezeEntries = await readRefundFreezeEntries(tx, [refund.id]);
    const platformFeePortion = refundFreezeDebit(freezeEntries, refund.id, 'PLATFORM_FEE');
    const providerFeePortion = refundFreezeDebit(freezeEntries, refund.id, 'REFUND_COST');
    const netPortion = refund.amount - platformFeePortion - providerFeePortion;
    // The pool was never over-drawn by this refund's own fee (that was
    // already removed correctly at freeze time) -- a negative reading here
    // is genuine insolvency (e.g. a Payout already spent the pool below
    // this refund's net share), never a fee artifact.
    const shortfall = Math.min(Math.max(0, -poolBalance), netPortion);

    // Kept, not replaced by the ledger's own one-claim-per-transaction index
    // (prd-compliance 28b, LedgerEntry_transactionId_claim_key). That index
    // would refuse this post a second time, but only by aborting the whole
    // transaction on a duplicate; claiming the row first means the loser is
    // told what actually happened -- another approval got there first -- and
    // writes nothing at all.
    const claimed = await tx.refund.updateMany({
      where: { id: refundId, status: 'REQUESTED' },
      data: {
        status: 'APPROVED',
        approvedById,
        donorBankCode: cleanBankCode,
        donorAccountName: cleanAccountName,
        ...sealedAccountNumber,
      },
    });
    if (claimed.count === 0) {
      throw new InvalidRefundStatusError('unknown (changed concurrently)', 'lost the approval race');
    }

    await postTransaction(
      tx,
      refundApprovedLegs({ subject, amount: refund.amount, source, shortfall }),
      { refundId: refund.id, transactionId: `refund-approved-${refund.id}` },
    );
  });

  return prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
}

/**
 * The third Admin completes an APPROVED Refund: transferred the money by
 * hand to the Donor's account the approving Admin already recorded
 * (CONTEXT.md, Refund; PRD §7.2), re-types that account number as the
 * second pair of eyes (Q7(c)) rather than typing a destination of its own,
 * and posts the withdrawal from the Provider Balance (refundPaidLegs,
 * ./ledger.ts -- ADR 0007: the full Gross, not only the Campaign's net
 * share, because that is what a Refund returns).
 *
 * TWO-PERSON RULE, THE REFUND VERSION (three people, not two pairs;
 * CONTEXT.md, Refund: "dibuat satu Admin, disetujui Admin lain, dan
 * diselesaikan Admin yang berbeda dari penyetujunya"). Unlike
 * completePayout, which only refuses the approver, this refuses BOTH the
 * Admin who requested the Refund and the Admin who approved it -- the same
 * check completePayout makes on approvedById, done twice, because a Refund
 * names a third distinct person where a Payout only ever named two.
 *
 * NO DESTINATION OF ITS OWN (Q7(c)). completeRefund no longer accepts
 * `donorBankCode`/`donorAccountName`/a fresh `donorAccountNumber` to
 * record -- those were moved to approveRefund. The only account input here
 * is the re-typed number to CHECK, never to write: it is compared, inside
 * the transaction, against the sealed number the approving Admin already
 * recorded, and on any mismatch this throws RefundDestinationMismatchError
 * (400) before the status update or the ledger post are reached, so a
 * mistyped re-entry writes nothing at all -- not even a failed attempt on
 * the row.
 *
 * PROOF IS CHECKED BEFORE THE TRANSACTION OPENS, exactly like completePayout
 * checks it: a blank field can never become a good one by reading the
 * database. The proof is judged by the exact `validateProofReference`/
 * `validateProofNote` functions completePayout already asks (@/lib/payout-
 * proof) -- ticket 13's one validator, now a third caller -- and joined
 * into `proofImage` by the same `buildProofImage`. The re-typed account
 * number is only shape-checked there (non-blank, bounded) through the same
 * `cleanDestinationText`; the actual comparison against the sealed value
 * needs the Refund row, so it happens inside the transaction, below.
 *
 * LEDGER LEGS: refundPaidLegs (./ledger.ts), the module's own
 * `NOT POSTED YET` note names this exact function as the reason it exists.
 * It takes no subject: both REFUND_CLEARING and GATEWAY_CLEARING are
 * platform-level, the same way payoutCompletedLegs takes none. The
 * subject is still locked below, for the same reason completePayout locks
 * it at completion -- so requireNotOwnerAsAdmin is judged under a lock, not
 * against a state that could have changed a moment before.
 *
 * THE DONOR ACCOUNT NUMBER IS DECRYPTED SERVER-SIDE ONLY TO COMPARE, NEVER
 * TO RETURN (ADR 0012). `readRefundDonorAccountNumber` (@/lib/contact-
 * fields.ts) reverses the exact seal approveRefund wrote; nothing this
 * function returns, and nothing any route or screen built on it should
 * return, ever includes the plaintext number in full -- an Admin's screen
 * shows it masked (maskBankAccountNumber, @/lib/bank-account-mask.ts), the
 * same way a Payout's destination is.
 */
export async function completeRefund(
  prisma: PrismaClient,
  params: {
    refundId: string;
    completedById: string;
    proofReference: string;
    proofNote: string;
    donorAccountNumber: string;
  },
): Promise<Refund> {
  const { refundId, completedById, proofReference, proofNote, donorAccountNumber } = params;

  // Checked before the transaction opens, mirroring completePayout: a bad
  // field can never become a good one by reading the database, so nothing
  // below is reached and the Refund keeps waiting in APPROVED for a third
  // Admin who supplies a proper proof and re-types the right number.
  const referenceError = validateProofReference(typeof proofReference === 'string' ? proofReference : '');
  if (referenceError) {
    throw new RefundProofInvalidError(referenceError);
  }
  const noteError = validateProofNote(typeof proofNote === 'string' ? proofNote : '');
  if (noteError) {
    throw new RefundProofInvalidError(noteError);
  }
  const proofImage = buildProofImage(proofReference, proofNote);

  const typedAccountNumber = cleanDestinationText(donorAccountNumber, 'Nomor rekening', 'donorAccountNumber');

  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: { include: { donation: true, registration: { include: { batch: true } } } },
      },
    });
    if (!refund) {
      throw new RefundNotFoundError(refundId);
    }

    if (refund.status !== 'APPROVED') {
      throw new InvalidRefundStatusError(refund.status);
    }

    // The whole two-person rule, before any write. A Refund names three
    // people (CONTEXT.md, Refund), so this checks both of the other two --
    // a self-completion, by either of them, leaves the Refund exactly as it
    // was, a refusal rather than a decision this Refund has been through.
    if (refund.requestedById === completedById || refund.approvedById === completedById) {
      throw new TwoPersonRuleError('Refund');
    }

    // The second pair of eyes (Q7(c)): decrypt the number the approving
    // Admin recorded and compare it, in constant time over normalised
    // digits, against what this Admin just re-typed. A mismatch refuses
    // before any write -- nothing about this Refund changes, and no ledger
    // leg is posted, for a re-entry that does not match.
    const recordedAccountNumber = readRefundDonorAccountNumber({
      donorAccountNumberCiphertext: refund.donorAccountNumberCiphertext,
      donorAccountNumberKeyId: refund.donorAccountNumberKeyId,
    });
    if (recordedAccountNumber === null || !accountNumbersMatch(typedAccountNumber, recordedAccountNumber)) {
      throw new RefundDestinationMismatchError();
    }

    const payment = refund.payment as unknown as PaymentWithSubjectLinks;
    const subject = paymentSubjectOf(payment);

    // Locked for the same reason completePayout locks its subject at
    // completion: requireNotOwnerAsAdmin is judged under the lock, not
    // against a state that could have changed a moment before. Nothing
    // here reads a balance -- refundPaidLegs takes no subject -- so the
    // lock's only job is to make the ownership check safe.
    const subjectState = await lockAndLoad(tx, subject, new Date());
    if (subjectState) requireNotOwnerAsAdmin(subjectState, completedById);

    const claimed = await tx.refund.updateMany({
      where: { id: refundId, status: 'APPROVED' },
      data: {
        status: 'COMPLETED',
        completedById,
        completedAt: new Date(),
        proofImage: proofImage.trim(),
      },
    });
    if (claimed.count === 0) {
      // refund.status above is the pre-update read and is now stale; some
      // other write got here first.
      throw new InvalidRefundStatusError('unknown (changed concurrently)', 'lost the completion race');
    }

    // Posted at completion, in the same transaction as the status write, so
    // a COMPLETED Refund never exists a moment without the withdrawal that
    // explains it. transactionId is keyed on the refund id, idempotent on
    // top of (not instead of) the updateMany guard above.
    await postTransaction(
      tx,
      refundPaidLegs({ amount: refund.amount }),
      { refundId: refund.id, transactionId: `refund-completed-${refund.id}` },
    );
  });

  return prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
}

const MAX_RESOLUTION_REASON_LENGTH = 500;

function cleanResolutionReason(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') throw new RefundReasonInvalidError('Alasan wajib diisi.');
  if (text.length > MAX_RESOLUTION_REASON_LENGTH) {
    throw new RefundReasonInvalidError(`Alasan maksimal ${MAX_RESOLUTION_REASON_LENGTH} karakter.`);
  }
  return text;
}

/**
 * The way back for a Refund (ticket 49; ticket 33): a Refund freezes the
 * subject's money when it is created and, once APPROVED, moves it to
 * REFUND_CLEARING, so a Refund that is wrong or cannot be paid has to return
 * that money, or it is locked for good.
 *
 * Reject (REQUESTED or AWAITING_DONOR_DETAILS) posts the exact mirror of the
 * freeze. Fail (APPROVED) posts the exact mirror of the freeze AND of the
 * approval, so REFUND_CLEARING is emptied and a shortfall the platform covered
 * with REFUND_COST is taken back out of the pool it topped up. Both mirror the
 * ENTRIES already posted (reverseEntriesLegs, ./ledger.ts), not a recomputation
 * from the Payment: the money goes back to precisely the accounts that were
 * debited, even when the Payment's escrow matured between freeze and approve.
 *
 * Same lock order as approveRefund/completeRefund: the subject first, then the
 * claim on the Refund row. A reject racing an approve is serialised by the
 * subject lock and the loser, whose claim matches nothing, is refused 409 with
 * nothing written. A COMPLETED Refund matches neither claim.
 *
 * ESCROW. If the freeze debited ESCROW_HOLD and that Payment's escrow has since
 * been released (the sweep only defers for REQUESTED/PROCESSING, so an APPROVED
 * Refund does not stop it, and the release already counted this Refund as
 * having taken its net share), the mirror alone would leave the net share
 * stranded in ESCROW_HOLD with nothing left to release it. So the same
 * transaction also posts the release of that share to the withdrawable balance,
 * exactly what the sweep would have done had the Refund never existed.
 */
async function resolveRefund(
  prisma: PrismaClient,
  params: { refundId: string; actorId: string; reason: string; action: 'reject' | 'fail' },
): Promise<Refund> {
  const { refundId, actorId, action } = params;
  const reason = cleanResolutionReason(params.reason);
  const allowedFrom = action === 'reject' ? (['REQUESTED', 'AWAITING_DONOR_DETAILS'] as const) : (['APPROVED'] as const);

  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: { include: { donation: true, registration: { include: { batch: true } } } },
      },
    });
    if (!refund) {
      throw new RefundNotFoundError(refundId);
    }

    const subject = paymentSubjectOf(refund.payment as unknown as PaymentWithSubjectLinks);
    const subjectState = await lockAndLoad(tx, subject, new Date());
    // An Admin act, refused to the Fundraiser of this Campaign or Trip.
    if (subjectState) requireNotOwnerAsAdmin(subjectState, actorId);

    if (!(allowedFrom as readonly string[]).includes(refund.status)) {
      throw new InvalidRefundStatusError(refund.status);
    }
    if (action === 'reject' ? refund.requestedById === actorId : refund.approvedById === actorId) {
      throw new RefundResolutionActorError(action);
    }

    const now = new Date();
    const claimed = await tx.refund.updateMany({
      where: { id: refundId, status: { in: [...allowedFrom] } },
      data:
        action === 'reject'
          ? { status: 'REJECTED', rejectedById: actorId, rejectedAt: now, rejectionReason: reason }
          : { status: 'FAILED', failedById: actorId, failedAt: now, failureReason: reason },
    });
    if (claimed.count === 0) {
      throw new InvalidRefundStatusError('unknown (changed concurrently)', `lost the ${action} race`);
    }

    const freezeId = refundFreezeTransactionId(refundId);
    const transactionIds = action === 'reject' ? [freezeId] : [freezeId, `refund-approved-${refundId}`];
    const entries = await tx.ledgerEntry.findMany({
      where: { refundId, transactionId: { in: transactionIds } },
      orderBy: [{ transactionId: 'asc' }, { legIndex: 'asc' }],
      select: {
        transactionId: true,
        account: true,
        direction: true,
        amount: true,
        campaignId: true,
        volunteerTripId: true,
      },
    });
    const posted = new Set(entries.map((e) => e.transactionId));
    if (transactionIds.some((id) => !posted.has(id))) {
      // A Refund without its journal cannot be mirrored; never guess the legs.
      throw new InvalidRefundStatusError(refund.status, 'its freeze or approval journal is missing');
    }

    await postTransaction(tx, reverseEntriesLegs(entries), {
      refundId,
      transactionId: `${action === 'reject' ? 'refund-rejected' : 'refund-failed'}-${refundId}`,
    });

    const escrowShare = refundFreezeDebit(entries, refundId, 'ESCROW_HOLD');
    if (escrowShare > 0) {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: refund.paymentId },
        select: { escrowReleasedAt: true },
      });
      if (payment.escrowReleasedAt != null) {
        await postTransaction(tx, escrowReleaseLegs({ subject, amount: escrowShare }), {
          paymentId: refund.paymentId,
          transactionId: `refund-reversal-release-${refundId}`,
        });
      }
    }
  });

  return prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
}

/**
 * An Admin other than the requester, and other than the Campaign's
 * Fundraiser, rejects a Refund that has not been approved yet. The freeze is
 * returned to the accounts it was taken from (see resolveRefund).
 */
export function rejectRefund(
  prisma: PrismaClient,
  params: { refundId: string; rejectedById: string; reason: string },
): Promise<Refund> {
  return resolveRefund(prisma, { refundId: params.refundId, actorId: params.rejectedById, reason: params.reason, action: 'reject' });
}

/**
 * An Admin other than the approver, and other than the Campaign's Fundraiser,
 * marks an APPROVED Refund as failed because the Donor could not be paid. The
 * money returns from REFUND_CLEARING to the accounts it came from.
 */
export function failRefund(
  prisma: PrismaClient,
  params: { refundId: string; failedById: string; reason: string },
): Promise<Refund> {
  return resolveRefund(prisma, { refundId: params.refundId, actorId: params.failedById, reason: params.reason, action: 'fail' });
}
