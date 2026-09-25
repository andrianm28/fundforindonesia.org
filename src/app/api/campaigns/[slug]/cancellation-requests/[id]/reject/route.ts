import { cancellationDecisionRoute } from "../decide";

/** An Admin who is not the Campaign's Fundraiser rejects its Cancellation request. */
export const POST = cancellationDecisionRoute("reject");
