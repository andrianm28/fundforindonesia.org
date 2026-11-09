import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { beginEnrollment } from "@/lib/mfa";
import { mfaCaller, refusalResponse } from "@/lib/mfa-route";

/**
 * POST /api/account/mfa/setup: begins enrolment and returns the secret and the
 * otpauth URI (shown as text and as a QR by the page). Refused once enrolled,
 * so a password alone cannot swap an existing factor.
 */
export async function POST() {
  const found = await mfaCaller();
  if ("response" in found) return found.response;
  const result = await beginEnrollment(prisma, { userId: found.caller.userId, account: found.caller.email });
  if (!result.ok) return refusalResponse(result);
  return NextResponse.json({ secret: result.secret, uri: result.uri });
}
