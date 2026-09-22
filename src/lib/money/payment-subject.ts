/**
 * A Payment describes money for exactly one thing -- a Donation (Campaign
 * money) or a Registration (Volunteer Trip money), never both, never
 * neither. This is the guard for that invariant: Prisma cannot express
 * "exactly one of these two columns is set" as a schema constraint, so this
 * is checked here, in application code, before a Payment is ever created.
 */
export class InvalidPaymentSubjectError extends Error {
  constructor() {
    super(
      'A Payment must have exactly one of donationId or registrationId set -- both or neither ' +
        'means the money this Payment describes has no single thing it is for.',
    );
    this.name = 'InvalidPaymentSubjectError';
  }
}

export function assertExactlyOnePaymentSubject(params: {
  donationId?: string | null;
  registrationId?: string | null;
}): void {
  const hasDonation = params.donationId != null;
  const hasRegistration = params.registrationId != null;
  if (hasDonation === hasRegistration) {
    throw new InvalidPaymentSubjectError();
  }
}
