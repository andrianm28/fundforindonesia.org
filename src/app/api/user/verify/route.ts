import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';

// Identity used to be self-declared here: any 16-digit NIK set isVerified and
// granted CAMPAIGN_CREATOR, with nothing stored and no Verifier involved
// (gap C2). Until Verifier-reviewed identity checks exist (ticket 12), this
// endpoint grants nothing; an Admin assigns the Fundraiser role by hand at
// /admin/users after checking identity off-platform.
export async function POST() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { error: "Verifikasi identitas sementara dilakukan oleh Admin. Hubungi kami untuk menjadi Fundraiser." },
    { status: 503 }
  );
}
