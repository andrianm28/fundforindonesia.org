import { decideCancellation, type CancellationDecision } from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * The shared declaration of `POST .../cancellation-requests/[id]/approve`
 * and `.../reject` `{ reason }`: an Admin who is not the Campaign's
 * Fundraiser decides the request named in the path.
 */
export function cancellationDecisionRoute(decision: CancellationDecision) {
  return lifecycleRoute({
    campaign: "slug",
    command: decideCancellation,
    input: ({ body, params }) => ({ requestId: params.id, decision, reason: body.reason }),
  });
}
