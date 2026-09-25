import { cancellationDecisionRoute } from "../decide";

/** An Admin who is not the Campaign's Fundraiser approves its Cancellation request. */
export const POST = cancellationDecisionRoute("approve");
