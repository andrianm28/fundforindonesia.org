import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySecondFactor } from "@/lib/mfa";
import { badCode, mfaCallerWithSession, proofFor, readCode, refusalResponse } from "@/lib/mfa-route";

/**
 * POST /api/account/mfa/verify { code }: a TOTP or backup code. On success the
 * answer is a short-lived proof the browser hands to next-auth's `update()`;
 * only the jwt callback can turn it into a satisfied session.
 */
export async function POST(req: NextRequest) {
  const found = await mfaCallerWithSession(req);
  if ("response" in found) return found.response;
  const code = await readCode(req);
  if (!code) return badCode();
  const result = await verifySecondFactor(prisma, { userId: found.caller.userId, code, now: Date.now() });
  if (!result.ok) return refusalResponse(result);
  return NextResponse.json({ proof: proofFor(found.caller, result.enabledAt) });
}
