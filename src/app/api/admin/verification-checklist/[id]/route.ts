import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { editChecklistItem } from "@/lib/verification-checklist";
import { checklistRoute } from "@/lib/verification-checklist-route";

/**
 * PATCH /api/admin/verification-checklist/[id]: rewords an item, marks it
 * required or optional, or deactivates or reactivates it. Body: any of
 * `{ label, required, active }`. ADMIN only; audited. There is no DELETE:
 * items are deactivated, never removed (verification-request 04).
 */
export const PATCH = checklistRoute(async ({ actorId, params, body }) => {
  const item = await editChecklistItem(prisma, {
    actorId,
    itemId: params.id,
    changes: { label: body.label, required: body.required, active: body.active },
  });
  return NextResponse.json({ item });
});
