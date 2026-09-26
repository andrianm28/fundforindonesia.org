import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addChecklistItem, listChecklistItems } from "@/lib/verification-checklist";
import { checklistRoute } from "@/lib/verification-checklist-route";

/**
 * GET /api/admin/verification-checklist: every checklist item, inactive ones
 * included, in order. POST adds one: `{ label, required }`. ADMIN only;
 * every change is audited (verification-request 04).
 */
export const GET = checklistRoute(
  async () => NextResponse.json({ items: await listChecklistItems(prisma) }),
  { readsBody: false }
);

export const POST = checklistRoute(async ({ actorId, body }) => {
  const item = await addChecklistItem(prisma, { actorId, label: body.label, required: body.required });
  return NextResponse.json({ item }, { status: 201 });
});
