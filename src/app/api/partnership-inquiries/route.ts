import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientAddress } from "@/lib/client-ip";
import { consumeRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import {
  createPartnershipInquiry,
  partnershipInquiryErrorToHttp,
  type PartnershipInquiryCreateInput,
} from "@/lib/partnership-inquiries";

/**
 * POST /api/partnership-inquiries: a company submits a Partnership Inquiry
 * about one Program (ticket 05; CONTEXT.md, Partnership Inquiry). Open to the
 * public by design -- the company being discussed with is not a Donor and has
 * no account, and requiring one would only keep the CSR team out of the form.
 * The follow-up status is never read from the body: a company cannot mark its
 * own Inquiry as followed up, and the module fixes the first value.
 *
 * The module checks every field itself and refuses with 400, or with 404 for a
 * Program that does not exist. A notification that could not be sent does not
 * change the answer: the Inquiry is recorded either way (see
 * createPartnershipInquiry).
 */
const RATE_SCOPE = "partnership-inquiry";
const WINDOW_SECONDS = 60 * 60;
/** Per client per hour: generous enough for a partner who fixes a typo or files for two Programs. */
const PER_CLIENT_LIMIT = 10;
/** All clients together per hour: the ceiling on a flood spread over many addresses. */
const GLOBAL_LIMIT = 300;
/**
 * The hidden form field a person never sees and a form-filling bot does. The
 * name is deliberately neutral: `website`, `url` and the like are names that
 * browser autofill recognises and fills for a real person.
 */
const HONEYPOT_FIELD = "fax_ref";

const REFUSAL_BODY = {
  error:
    "Permintaan Anda sedang terlalu banyak diterima. Mohon tunggu sekitar satu jam lalu coba lagi, atau hubungi tim kemitraan kami lewat kanal resmi di situs ini.",
};

class GlobalLimitReachedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("global rate limit reached");
  }
}

/**
 * The limiter is spam protection, not authentication, so it FAILS OPEN: if the
 * secret is missing or the limiter's database is down, the request is served
 * rather than turned into a 500 on the partnership form (decision on PR #161).
 * The failure is logged by error class only: no address, no form content.
 */
async function consumeOrOpen(input: Parameters<typeof consumeRateLimit>[1]): Promise<RateLimitResult | null> {
  try {
    return await consumeRateLimit(prisma, input);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "rate_limit_unavailable",
        scope: input.scope,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return null;
  }
}

function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(REFUSAL_BODY, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
}

export async function POST(req: NextRequest) {
  // Counted before the body is read, so malformed floods are bounded too, and
  // before anything is written or mailed: a refusal costs one counter update.
  const perClient = await consumeOrOpen({
    scope: RATE_SCOPE,
    subject: clientAddress(req.headers),
    limit: PER_CLIENT_LIMIT,
    windowSeconds: WINDOW_SECONDS,
  });
  if (perClient && !perClient.allowed) return tooManyRequests(perClient.retryAfterSeconds);

  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
  }

  // A filled honeypot is answered as a success -- same status, nothing that
  // says why -- and nothing is written or mailed, so a bot learns nothing.
  // Any non-string value counts as filled; a string counts once trimmed.
  const trap = (parsed as Record<string, unknown>)[HONEYPOT_FIELD];
  if (trap !== undefined && trap !== null && (typeof trap !== "string" || trap.trim() !== "")) {
    console.warn(JSON.stringify({ event: "honeypot_triggered", route: "partnership-inquiries" }));
    return NextResponse.json({ received: true }, { status: 201 });
  }

  try {
    const inquiry = await createPartnershipInquiry(prisma, parsed as PartnershipInquiryCreateInput, undefined, async () => {
      // The all-clients ceiling counts only what would be recorded: invalid,
      // trapped or malformed requests cannot burn it for real partners.
      const overall = await consumeOrOpen({
        scope: `${RATE_SCOPE}:all`,
        subject: "all",
        limit: GLOBAL_LIMIT,
        windowSeconds: WINDOW_SECONDS,
      });
      if (overall && !overall.allowed) {
        // One line per window: at the first refusal, not at every one after it.
        if (overall.count === GLOBAL_LIMIT + 1) {
          console.warn(JSON.stringify({ event: "rate_limit_global_reached", scope: RATE_SCOPE, limit: GLOBAL_LIMIT }));
        }
        throw new GlobalLimitReachedError(overall.retryAfterSeconds);
      }
    });
    return NextResponse.json({ inquiry }, { status: 201 });
  } catch (error) {
    if (error instanceof GlobalLimitReachedError) return tooManyRequests(error.retryAfterSeconds);
    const refusal = partnershipInquiryErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
