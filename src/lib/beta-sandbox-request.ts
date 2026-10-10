import { connection } from 'next/server';
import { isBetaSandbox } from '@/lib/deploy-environment';

/**
 * Whether this request is served by the public beta, for a server component
 * that renders the answer into the page (the root layout).
 *
 * `connection()` first, so the page is rendered per request. Without it Next
 * prerenders a route that reads no request data, and `process.env.BETA_SANDBOX`
 * would be read once at BUILD time -- in the image build, where the marker is
 * absent -- and then baked into the HTML for good: the banner would never show
 * in the beta, and would never go away if the owner removed the marker at
 * go-live. That is the one failure this module exists to rule out.
 */
export async function betaSandboxForThisRequest(): Promise<boolean> {
  await connection();
  return isBetaSandbox();
}
