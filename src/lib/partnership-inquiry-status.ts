/**
 * The vocabulary of a Partnership Inquiry's pipeline (CONTEXT.md, Partnership
 * Inquiry; tickets csr-05, csr-06 and pks-pemenuhan/17, PKS Pasal 3.6): which
 * stages it has, what a new one starts at, what each is called in Indonesian,
 * and the one rule on moving between them.
 *
 * It is a leaf on purpose. The create-and-notify module reaches the Mailer,
 * and the Mailer reaches nodemailer, so anything a browser bundle imports must
 * not import that module -- the Admin page that shows the pipeline needs these
 * names and nothing else. `partnership-inquiries.ts` re-exports them, so the
 * seam ticket 05 landed still says what it always said.
 */

/**
 * The eight stages, in pipeline order, mirroring the `PartnershipInquiryStatus`
 * enum in the schema. Before pks-pemenuhan/17 there were three
 * (NOT_YET_FOLLOWED_UP, IN_PROGRESS, DONE); the migration maps them to NEW,
 * CONTACTED and DONE.
 */
export const PARTNERSHIP_INQUIRY_STATUSES = [
  'NEW',
  'CONTACTED',
  'PROPOSAL',
  'NEGOTIATION',
  'APPROVED',
  'ONGOING',
  'DONE',
  'DROPPED',
] as const;

export type PartnershipInquiryStatusValue = (typeof PARTNERSHIP_INQUIRY_STATUSES)[number];

/** Every new Inquiry starts here, whatever the submitting body claims. */
export const INITIAL_INQUIRY_STATUS: PartnershipInquiryStatusValue = 'NEW';

/**
 * The label a person reads for each stage, next to the code so the two cannot
 * drift apart. Indonesian, like every other label the platform shows.
 */
export const INQUIRY_STATUS_LABEL: Record<PartnershipInquiryStatusValue, string> = {
  NEW: 'Baru',
  CONTACTED: 'Dihubungi',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negosiasi',
  APPROVED: 'Disetujui',
  ONGOING: 'Berjalan',
  DONE: 'Selesai',
  DROPPED: 'Tidak dilanjutkan',
};

export function isInquiryStatus(value: unknown): value is PartnershipInquiryStatusValue {
  return typeof value === 'string' && (PARTNERSHIP_INQUIRY_STATUSES as readonly string[]).includes(value);
}

/** The two stages that close an Inquiry; leaving either needs a reason. */
const CLOSED_STATUSES: readonly PartnershipInquiryStatusValue[] = ['DONE', 'DROPPED'];

/**
 * Whether moving from `from` to `to` needs a written reason: only when it
 * leaves Selesai or Tidak dilanjutkan for another stage. Every other move,
 * forward or back, is free (owner, PKS Pasal 3.6): a conversation can stall
 * and resume, and a rule forcing one step at a time would only make the team
 * click through stages that did not happen.
 */
export function inquiryTransitionNeedsReason(
  from: PartnershipInquiryStatusValue,
  to: PartnershipInquiryStatusValue,
): boolean {
  return from !== to && CLOSED_STATUSES.includes(from);
}

/** The budget ranges a company may choose from, mirroring `PartnershipBudgetRange`. */
export const PARTNERSHIP_BUDGET_RANGES = ['UNDER_50M', 'FROM_50M_TO_250M', 'FROM_250M_TO_1B', 'OVER_1B'] as const;

export type PartnershipBudgetRangeValue = (typeof PARTNERSHIP_BUDGET_RANGES)[number];

export const BUDGET_RANGE_LABEL: Record<PartnershipBudgetRangeValue, string> = {
  UNDER_50M: 'Di bawah Rp50 juta',
  FROM_50M_TO_250M: 'Rp50 juta - Rp250 juta',
  FROM_250M_TO_1B: 'Rp250 juta - Rp1 miliar',
  OVER_1B: 'Di atas Rp1 miliar',
};

export function isBudgetRange(value: unknown): value is PartnershipBudgetRangeValue {
  return typeof value === 'string' && (PARTNERSHIP_BUDGET_RANGES as readonly string[]).includes(value);
}
