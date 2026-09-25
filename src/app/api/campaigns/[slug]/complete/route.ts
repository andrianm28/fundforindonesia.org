import { completeCampaign } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * Marks a Campaign Completed: its owner as Fundraiser, or an Admin who does
 * not own it, with a reason. The body is optional: an owner may send none.
 */
export const POST = lifecycleRoute({
  campaign: "slug",
  command: completeCampaign,
  input: ({ body }) => ({ reason: body.reason }),
});
