import { liftSuspension, suspendCampaign } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * Suspension of a Campaign as a resource: POST imposes it, DELETE lifts it
 * (ADR 0015, FFI-07b). Both take `{ reason }`.
 */
export const POST = lifecycleRoute({
  campaign: "slug",
  command: suspendCampaign,
  input: ({ body }) => ({ reason: body.reason }),
});

export const DELETE = lifecycleRoute({
  campaign: "slug",
  command: liftSuspension,
  input: ({ body }) => ({ reason: body.reason }),
});
