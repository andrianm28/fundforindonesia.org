/**
 * The sentence an Admin who is also the Fundraiser of a Campaign or Volunteer
 * Trip reads where an Admin act on that subject's Refund would be (CONTEXT.md,
 * Refund; the server refuses it with OwnSubjectConflictError, 403). Shared by
 * the approve, complete, reject and fail forms so the four say the same thing.
 */
const SUBJECT_NAME = { campaign: 'Campaign', trip: 'Volunteer Trip' } as const;

export function OwnSubjectNotice({ subjectType }: { subjectType: 'campaign' | 'trip' }) {
  const name = SUBJECT_NAME[subjectType];
  return (
    <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {`Anda adalah Fundraiser ${name} ini, jadi tidak bisa bertindak sebagai Admin atas ${name} milik Anda sendiri -- tindakan ini harus dilakukan Admin lain.`}
    </p>
  );
}
