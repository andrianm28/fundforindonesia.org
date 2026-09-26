import { assignCollectingEntity } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * An Admin or Verifier names the Collecting Entity of an Active Campaign
 * that has none: `{ collectingEntityId, reason }` (prd-compliance 10).
 */
export const PUT = lifecycleRoute({
  campaign: "slug",
  command: assignCollectingEntity,
  input: ({ body }) => ({ collectingEntityId: body.collectingEntityId, reason: body.reason }),
});
