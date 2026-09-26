import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { partnerOrganisationRoute } from "@/lib/partner-organisation-route";
import { registerPartnerOrganisation } from "@/lib/partner-organisations";

/**
 * Every Partner Organisation with its linked account, permits and Kind
 * Authorisations, by name: what the Verifier's register shows.
 */
export const GET = partnerOrganisationRoute(
  async () => {
    const organisations = await prisma.partnerOrganisation.findMany({
      orderBy: { name: "asc" },
      include: {
        fundraiser: { select: { name: true, email: true } },
        permits: { orderBy: { validTo: "desc" } },
        kindAuthorisations: { orderBy: { validTo: "desc" } },
      },
    });
    return NextResponse.json({ organisations });
  },
  { readsBody: false }
);

/**
 * A Verifier registers a Partner Organisation after checking its legal
 * documents: `{ name, fundraiserEmail, acceptsIndividualCampaigns }`.
 */
export const POST = partnerOrganisationRoute(async ({ actorId, body }) => {
  const organisation = await registerPartnerOrganisation(prisma, {
    actorId,
    name: body.name,
    fundraiserEmail: body.fundraiserEmail,
    acceptsIndividualCampaigns: body.acceptsIndividualCampaigns,
  });
  return NextResponse.json({ organisation }, { status: 201 });
});
