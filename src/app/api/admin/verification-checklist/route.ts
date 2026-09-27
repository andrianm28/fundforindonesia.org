import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addChecklistItem, listChecklistItems } from "@/lib/verification-checklist";
import { checklistRoute } from "@/lib/verification-checklist-route";
import { parseKind } from "@/lib/campaign-kind";

/**
 * GET /api/admin/verification-checklist: every checklist item, inactive ones
 * included, in order; `?kind=` narrows it to that Kind's items plus the
 * general ones. POST adds one: `{ label, required, kind? }`, where an absent
 * or null Kind is general ("Semua"). ADMIN only; every change is audited
 * (verification-request 04, ticket 12 per-Kind checklists).
 */
export const GET = checklistRoute(
  async ({ query }) => {
    const kindParam = query.get("kind");
    const kind = kindParam === null ? undefined : parseKind(kindParam);
    if (kindParam !== null && !kind) {
      return NextResponse.json({ error: "Kind tidak dikenal" }, { status: 400 });
    }
    return NextResponse.json({ items: await listChecklistItems(prisma, { kind }) });
  },
  { readsBody: false }
);

export const POST = checklistRoute(async ({ actorId, body }) => {
  const item = await addChecklistItem(prisma, { actorId, label: body.label, required: body.required, kind: body.kind });
  return NextResponse.json({ item }, { status: 201 });
});
