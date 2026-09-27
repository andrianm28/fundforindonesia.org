import { NextResponse } from "next/server";
import { readUserEmail, SELECT_USER_EMAIL } from "@/lib/contact-fields";
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
        fundraiser: { select: { name: true, ...SELECT_USER_EMAIL } },
        permits: { orderBy: { validTo: "desc" } },
        kindAuthorisations: { orderBy: { validTo: "desc" } },
      },
    });
    // Decrypted on the way out, so the register shows the Verifier the address
    // they registered the organisation with (ADR 0012; the ciphertext is what is
    // stored, not what is shown).
    return NextResponse.json({
      organisations: organisations.map(({ fundraiser, ...organisation }) => ({
        ...organisation,
        fundraiser: { name: fundraiser.name, email: readUserEmail(fundraiser) },
      })),
    });
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
