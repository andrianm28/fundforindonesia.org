import { cancellationDecisionRoute } from "../decide";

/** An Admin who does not own the Campaign approves its Cancellation request. */
export const POST = cancellationDecisionRoute("approve");
