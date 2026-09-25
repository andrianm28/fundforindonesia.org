import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  CampaignNotFoundError,
  domainErrorToHttp,
  type LifecycleActor,
} from "@/lib/campaign-lifecycle";

type RouteParams = Record<string, string>;

/** How a route addresses its Campaign: by the `slug` or the `id` route param. */
type CampaignKey = CampaignNotFoundError["by"];

/** What the adapter supplies to every command; the route builds the rest. */
type CommandTarget = { campaignId: string; actor: LifecycleActor };

type JsonBody = Record<string, unknown>;

/** Anything but a JSON object (no body, malformed JSON, an array, null) reads as `{}`. */
async function readBody(req: NextRequest): Promise<JsonBody> {
  const body: unknown = await req.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as JsonBody)
    : {};
}

async function resolveCampaignId(by: CampaignKey, params: RouteParams): Promise<string> {
  if (by === "id") return params.id;
  const campaign = await prisma.campaign.findUnique({
    where: { slug: params.slug },
    select: { id: true },
  });
  if (!campaign) throw new CampaignNotFoundError(params.slug, "slug");
  return campaign.id;
}

/**
 * The one HTTP adapter for lifecycle routes (spec
 * lifecycle-runner-and-adapter). A route declares only which command it
 * calls, how the Campaign is addressed (`slug` param, resolved here; or `id`
 * param, passed through), how to build the rest of the command's input from
 * the body and params, and its success status (200 unless it creates, 201).
 *
 * In order: no session → 401 `UNAUTHENTICATED`; the body is parsed, anything
 * but a JSON object reading as `{}`; the input builder runs, and may refuse
 * with `LifecycleValidationError` (400) before anything is looked up; an
 * unknown slug → 404 `CAMPAIGN_NOT_FOUND` with `by: "slug"`; then the
 * command. Every lifecycle refusal answers through `domainErrorToHttp`;
 * anything else is logged and answered with one Indonesian 500
 * `INTERNAL_ERROR`. Assignment checks are the command's, not the route's.
 */
export function lifecycleRoute<
  Input extends CommandTarget,
  Result,
>(route: {
  campaign: CampaignKey;
  command: (db: PrismaClient, input: Input) => Promise<Result>;
  input: (request: { body: JsonBody; params: RouteParams }) => Omit<Input, keyof CommandTarget | "now">;
  status?: 200 | 201;
}) {
  return async (req: NextRequest, context: { params: Promise<RouteParams> }): Promise<NextResponse> => {
    try {
      const session = await getServerSession();
      if (!session?.user) {
        return NextResponse.json(
          { error: "Anda harus login terlebih dahulu.", code: "UNAUTHENTICATED" },
          { status: 401 }
        );
      }
      const actor = { userId: session.user.id, assignments: session.user.assignments ?? [] };
      const params = await context.params;
      const input = route.input({ body: await readBody(req), params });
      const campaignId = await resolveCampaignId(route.campaign, params);
      // Omit<Input, CommandTarget keys> plus those keys is Input; TypeScript
      // cannot prove that for a generic Input.
      const result = await route.command(prisma, { ...input, campaignId, actor } as unknown as Input);
      return NextResponse.json(result, { status: route.status ?? 200 });
    } catch (error) {
      return errorResponse(req, error);
    }
  };
}

/**
 * A lifecycle refusal answers its own status, code and Indonesian message
 * (plus `by` for a missing Campaign); anything else is logged and answered
 * with one Indonesian 500 that leaks nothing.
 */
function errorResponse(req: NextRequest, error: unknown): NextResponse {
  const refusal = domainErrorToHttp(error);
  if (refusal) {
    const body =
      error instanceof CampaignNotFoundError ? { ...refusal.body, by: error.by } : refusal.body;
    return NextResponse.json(body, { status: refusal.status });
  }
  console.error(`Lifecycle route ${req.method} ${req.nextUrl.pathname} failed:`, error);
  return NextResponse.json(
    { error: "Terjadi kesalahan pada server.", code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}
