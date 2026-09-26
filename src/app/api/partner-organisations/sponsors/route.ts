import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sponsorOptionsFor } from "@/lib/partner-organisations";

// Per signed-in user: never cached.
export const dynamic = "force-dynamic";

/**
 * What the Campaign creation form offers the signed-in user as Collecting
 * Entity (prd-compliance 10): `{ own, sponsors }`, their own organisation
 * when their account acts for one, else the organisations accepting
 * individual Campaigns.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await sponsorOptionsFor(prisma, session.user.id));
}
