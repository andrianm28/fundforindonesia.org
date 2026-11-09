import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { regenerateBackupCodes } from "@/lib/mfa";
import { badCode, mfaCaller, readCode, refusalResponse } from "@/lib/mfa-route";

/**
 * POST /api/account/mfa/backup-codes { code }: replaces the backup codes. Needs
 * a valid TOTP code, not a backup one and not just the session.
 */
export async function POST(req: NextRequest) {
  const found = await mfaCaller();
  if ("response" in found) return found.response;
  const code = await readCode(req);
  if (!code) return badCode();
  const result = await regenerateBackupCodes(prisma, { userId: found.caller.userId, code, now: Date.now() });
  if (!result.ok) return refusalResponse(result);
  return NextResponse.json({ backupCodes: result.backupCodes });
}
