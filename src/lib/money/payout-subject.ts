/**
 * A Payout instructs money for exactly one thing -- a Campaign or a
 * Volunteer Trip, never both, never neither. This is the guard for that
 * invariant: Prisma cannot express "exactly one of these two columns is
 * set" as a schema constraint, so this is checked here, in application
 * code, before a Payout is ever created.
 */
export class InvalidPayoutSubjectError extends Error {
  constructor() {
    super(
      'A Payout is for exactly one Campaign or one Volunteer Trip (campaignId or volunteerTripId) -- ' +
        'both, neither, or any other subject, such as a Program, means the money it instructs has ' +
        'no single thing it is for.',
    );
    this.name = 'InvalidPayoutSubjectError';
  }
}

export function assertExactlyOnePayoutSubject(params: {
  campaignId?: string | null;
  volunteerTripId?: string | null;
}): void {
  const hasCampaign = params.campaignId != null;
  const hasTrip = params.volunteerTripId != null;
  if (hasCampaign === hasTrip) {
    throw new InvalidPayoutSubjectError();
  }
}
