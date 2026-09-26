import { withdrawVerificationRequest } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * POST /api/campaigns/[slug]/verification-requests/[id]/withdraw: the
 * Fundraiser withdraws their undecided Verification Request, and the
 * Campaign goes back to Draft or Rejected. No body. The right comes from
 * owning the Campaign, not from an assignment.
 */
export const POST = lifecycleRoute({
  campaign: "slug",
  command: withdrawVerificationRequest,
  input: ({ params }) => ({ requestId: params.id }),
});
