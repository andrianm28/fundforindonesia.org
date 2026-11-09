import { submitCampaign } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * POST /api/campaigns/[slug]/verification-requests: the Fundraiser submits
 * their Draft or Rejected Campaign to a Verifier, opening a new Verification
 * Request. The body is `{ truthStatement: true }`, the ticked "pernyataan
 * kebenaran data" (PKS pasal 3.3); without it the submission is refused 400.
 * The right comes from owning the Campaign, not from an assignment.
 */
export const POST = lifecycleRoute({
  campaign: "slug",
  command: submitCampaign,
  input: ({ body }) => ({ truthStatement: body.truthStatement }),
  status: 201,
});
