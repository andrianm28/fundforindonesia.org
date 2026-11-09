import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { confirmEnrollment } from "@/lib/mfa";
import { badCode, mfaCallerWithSession, proofFor, readCode, refusalResponse } from "@/lib/mfa-route";

/**
 * POST /api/account/mfa/confirm { code }: confirms enrolment with a first code,
 * returns the ten backup codes (the only time they are shown) and a proof, so
 * the session that enrolled is the one that is satisfied.
 */
export async function POST(req: NextRequest) {
  const found = await mfaCallerWithSession(req);
  if ("response" in found) return found.response;
  const code = await readCode(req);
  if (!code) return badCode();
  const result = await confirmEnrollment(prisma, { userId: found.caller.userId, code, now: Date.now() });
  if (!result.ok) return refusalResponse(result);
  return NextResponse.json({ backupCodes: result.backupCodes, proof: proofFor(found.caller, result.enabledAt) });
}
