import { cancellationDecisionRoute } from "../decide";

/** An Admin who does not own the Campaign rejects its Cancellation request. */
export const POST = cancellationDecisionRoute("reject");
