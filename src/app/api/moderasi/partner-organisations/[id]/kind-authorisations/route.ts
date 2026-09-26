import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partnerOrganisationRoute } from "@/lib/partner-organisation-route";
import { grantKindAuthorisation } from "@/lib/partner-organisations";

/**
 * A Verifier grants a Kind Authorisation the organisation holds for one
 * non-donation Kind: `{ kind, documentReference, validFrom, validTo }`, the
 * dates as ISO instants (prd-compliance 11).
 */
export const POST = partnerOrganisationRoute(async ({ actorId, params, body }) => {
  const kindAuthorisation = await grantKindAuthorisation(prisma, {
    actorId,
    organisationId: params.id,
    kind: body.kind,
    documentReference: body.documentReference,
    validFrom: body.validFrom,
    validTo: body.validTo,
  });
  return NextResponse.json({ kindAuthorisation }, { status: 201 });
});
