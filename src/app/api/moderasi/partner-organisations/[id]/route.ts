import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partnerOrganisationRoute } from "@/lib/partner-organisation-route";
import { updatePartnerOrganisation } from "@/lib/partner-organisations";

/** A Verifier renames a Partner Organisation or changes whether it accepts individual Campaigns. */
export const PATCH = partnerOrganisationRoute(async ({ actorId, params, body }) => {
  const organisation = await updatePartnerOrganisation(prisma, {
    actorId,
    organisationId: params.id,
    changes: { name: body.name, acceptsIndividualCampaigns: body.acceptsIndividualCampaigns },
  });
  return NextResponse.json({ organisation });
});
