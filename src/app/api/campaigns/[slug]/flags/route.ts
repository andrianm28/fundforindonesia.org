import { flagCampaign } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * POST /api/campaigns/[slug]/flags `{ reason }`: a Verifier raises a Flag on
 * a Campaign so an Admin can decide on Suspension (FFI-07b).
 */
export const POST = lifecycleRoute({
  campaign: "slug",
  command: flagCampaign,
  input: ({ body }) => ({ reason: body.reason }),
  status: 201,
});
