import { submitCampaign } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * POST /api/campaigns/[slug]/verification-requests: the Fundraiser submits
 * their Draft or Rejected Campaign to a Verifier, opening a new Verification
 * Request. No body. The right comes from owning the Campaign, not from an
 * assignment.
 */
export const POST = lifecycleRoute({
  campaign: "slug",
  command: submitCampaign,
  input: () => ({}),
  status: 201,
});
