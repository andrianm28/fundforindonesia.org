import { dismissFlag } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * POST /api/campaigns/[slug]/flags/[id]/dismiss `{ reason }`: an Admin who
 * is not the Campaign's Fundraiser dismisses an open Flag.
 */
export const POST = lifecycleRoute({
  campaign: "slug",
  command: dismissFlag,
  input: ({ body, params }) => ({ flagId: params.id, reason: body.reason }),
});
