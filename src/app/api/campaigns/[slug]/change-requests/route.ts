import { requestCampaignChange } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * POST /api/campaigns/[slug]/change-requests `{ targetAmount?, deadline? }`:
 * the Fundraiser of an Active Campaign asks for a new target and/or deadline
 * (PRD FFI-05). Opens a Verification Request; the Campaign keeps its old
 * values until a Verifier approves. The right to ask comes from owning the
 * Campaign, not from an assignment.
 */
export const POST = lifecycleRoute({
  campaign: "slug",
  command: requestCampaignChange,
  input: ({ body }) => ({
    changes: {
      ...("targetAmount" in body && { targetAmount: body.targetAmount }),
      ...("deadline" in body && { deadline: body.deadline }),
    },
  }),
  status: 201,
});
