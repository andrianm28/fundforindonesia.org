import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partnerOrganisationRoute } from "@/lib/partner-organisation-route";
import { recordFundraisingPermit } from "@/lib/partner-organisations";

/**
 * A Verifier records a Fundraising Permit the organisation holds:
 * `{ number, issuer, kinds, validFrom, validTo }`, the dates as ISO instants.
 */
export const POST = partnerOrganisationRoute(async ({ actorId, params, body }) => {
  const permit = await recordFundraisingPermit(prisma, {
    actorId,
    organisationId: params.id,
    number: body.number,
    issuer: body.issuer,
    kinds: body.kinds,
    validFrom: body.validFrom,
    validTo: body.validTo,
  });
  return NextResponse.json({ permit }, { status: 201 });
});
