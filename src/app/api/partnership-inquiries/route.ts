import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientAddress } from "@/lib/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit";
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
/** The hidden form field a person never sees and a form-filling bot does. */
const HONEYPOT_FIELD = "website";

export async function POST(req: NextRequest) {
  // Counted before the body is read, so malformed floods are bounded too, and
  // before anything is written or mailed: a refusal costs one counter update.
  const perClient = await consumeRateLimit(prisma, {
    scope: RATE_SCOPE,
    subject: clientAddress(req.headers),
    limit: PER_CLIENT_LIMIT,
    windowSeconds: WINDOW_SECONDS,
  });
  const overall = perClient.allowed
    ? await consumeRateLimit(prisma, {
        scope: `${RATE_SCOPE}:all`,
        subject: "all",
        limit: GLOBAL_LIMIT,
        windowSeconds: WINDOW_SECONDS,
      })
    : perClient;
  if (!overall.allowed) {
    return NextResponse.json(
      {
        error:
          "Permintaan Anda sedang terlalu banyak diterima. Mohon tunggu sekitar satu jam lalu coba lagi, atau hubungi tim kemitraan kami lewat kanal resmi di situs ini.",
      },
      { status: 429, headers: { "Retry-After": String(overall.retryAfterSeconds) } },
    );
  }

  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
  }

  // A filled honeypot is answered as a success -- same status, nothing that
  // says why -- and nothing is written or mailed, so a bot learns nothing.
  if (typeof (parsed as Record<string, unknown>)[HONEYPOT_FIELD] === "string" && (parsed as Record<string, string>)[HONEYPOT_FIELD] !== "") {
    return NextResponse.json({ received: true }, { status: 201 });
  }

  try {
    const inquiry = await createPartnershipInquiry(prisma, parsed as PartnershipInquiryCreateInput);
    return NextResponse.json({ inquiry }, { status: 201 });
  } catch (error) {
    const refusal = partnershipInquiryErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
