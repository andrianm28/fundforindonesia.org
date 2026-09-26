import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partnerOrganisationRoute } from "@/lib/partner-organisation-route";
import { updateFundraisingPermit } from "@/lib/partner-organisations";

/** A Verifier corrects or renews a Fundraising Permit: any of `number`, `issuer`, `kinds`, `validFrom`, `validTo`. */
export const PATCH = partnerOrganisationRoute(async ({ actorId, params, body }) => {
  const permit = await updateFundraisingPermit(prisma, {
    actorId,
    organisationId: params.id,
    permitId: params.permitId,
    changes: {
      number: body.number,
      issuer: body.issuer,
      kinds: body.kinds,
      validFrom: body.validFrom,
      validTo: body.validTo,
    },
  });
  return NextResponse.json({ permit });
});
