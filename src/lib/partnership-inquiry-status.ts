/**
 * The vocabulary of a Partnership Inquiry's follow-up (CONTEXT.md, Partnership
 * Inquiry; tickets csr-05 and csr-06): which statuses it has, what a new one
 * starts at, what each is called in Indonesian, and the one step forward from
 * each.
 *
 * It is a leaf on purpose. The create-and-notify module reaches the Mailer,
 * and the Mailer reaches nodemailer, so anything a browser bundle imports must
 * not import that module -- the Admin page that shows the queue needs these
 * names and nothing else. `partnership-inquiries.ts` re-exports them, so the
 * seam ticket 05 landed still says what it always said.
 */

/**
 * How far the partnership team has taken an Inquiry along, mirroring the
 * `PartnershipInquiryStatus` enum in the schema. Ticket 05 only ever writes
 * the first value; ticket 06 moves it forward and records who did so and when.
 */
export const PARTNERSHIP_INQUIRY_STATUSES = ['NOT_YET_FOLLOWED_UP', 'IN_PROGRESS', 'DONE'] as const;

export type PartnershipInquiryStatusValue = (typeof PARTNERSHIP_INQUIRY_STATUSES)[number];

/** Every new Inquiry starts here, whatever the submitting body claims. */
export const INITIAL_INQUIRY_STATUS: PartnershipInquiryStatusValue = 'NOT_YET_FOLLOWED_UP';

/**
 * The label a person reads for each status, next to the code so the two
 * cannot drift apart. Indonesian, like every other label the platform shows;
 * the values stay the codes the schema stores.
 */
export const INQUIRY_STATUS_LABEL: Record<PartnershipInquiryStatusValue, string> = {
  NOT_YET_FOLLOWED_UP: 'Belum ditindaklanjuti',
  IN_PROGRESS: 'Ditindaklanjuti',
  DONE: 'Selesai',
};

/** The refusal for a status the platform does not know, naming what it accepts. */
export function isInquiryStatus(value: unknown): value is PartnershipInquiryStatusValue {
  return typeof value === 'string' && (PARTNERSHIP_INQUIRY_STATUSES as readonly string[]).includes(value);
}

/** A status an Inquiry can be moved to; never where it already is. */
export type FollowUpStep = 'IN_PROGRESS' | 'DONE';

/**
 * The one status an Inquiry may move to next, or null when it is DONE.
 *
 * Forward only, one step at a time: a follow-up is a queue someone works
 * through, and a status that could go back would let a done conversation look
 * like a new one. A company never moves its own Inquiry, so there is no
 * "unfollow" and nothing to reopen it with.
 */
export function nextInquiryStatus(status: PartnershipInquiryStatusValue): FollowUpStep | null {
  if (status === 'NOT_YET_FOLLOWED_UP') return 'IN_PROGRESS';
  if (status === 'IN_PROGRESS') return 'DONE';
  return null;
}
