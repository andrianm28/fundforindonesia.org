import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';

// Identity used to be self-declared here: any 16-digit NIK set the user's
// verified flag and granted CAMPAIGN_CREATOR, with nothing stored and no Verifier involved
// (gap C2). Until Verifier-reviewed identity checks exist (ticket 12), this
// endpoint grants nothing. No Role is needed to submit (PRD FFI-04): the
// Verifier checks identity off-platform before approving a person's first
// submission.
export async function POST() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { error: "Verifikasi identitas mandiri tidak tersedia. Siapa pun yang terdaftar dapat mengajukan Campaign atau Volunteer Trip; Verifier meninjaunya sebelum terbit." },
    { status: 503 }
  );
}
