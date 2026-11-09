import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partnerOrganisationRoute } from "@/lib/partner-organisation-route";
import { toRegisterView, updatePartnerOrganisation } from "@/lib/partner-organisations";

/**
 * A Verifier renames a Partner Organisation, changes whether it accepts
 * individual Campaigns, or fills in or corrects its address and the person
 * responsible (PKS pasal 3.2).
 */
export const PATCH = partnerOrganisationRoute(async ({ actorId, params, body }) => {
  const organisation = await updatePartnerOrganisation(prisma, {
    actorId,
    organisationId: params.id,
    changes: {
      name: body.name,
      acceptsIndividualCampaigns: body.acceptsIndividualCampaigns,
      address: body.address,
      responsiblePersonName: body.responsiblePersonName,
      responsiblePersonTitle: body.responsiblePersonTitle,
      responsiblePersonPhone: body.responsiblePersonPhone,
    },
  });
  return NextResponse.json({ organisation: toRegisterView(organisation) });
});
