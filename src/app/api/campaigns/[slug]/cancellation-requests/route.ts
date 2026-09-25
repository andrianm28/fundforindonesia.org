import { requestCancellation } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * POST /api/campaigns/[slug]/cancellation-requests `{ reason }`: the
 * Fundraiser of an Active Campaign asks for its Cancellation. The right to
 * ask comes from being the Campaign's Fundraiser, not from an assignment.
 */
export const POST = lifecycleRoute({
  campaign: "slug",
  command: requestCancellation,
  input: ({ body }) => ({ reason: body.reason }),
  status: 201,
});
