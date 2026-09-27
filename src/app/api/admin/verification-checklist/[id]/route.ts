import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { editChecklistItem } from "@/lib/verification-checklist";
import { checklistRoute } from "@/lib/verification-checklist-route";

/**
 * PATCH /api/admin/verification-checklist/[id]: rewords an item, marks it
 * required or optional, scopes it to one Kind or back to general (`kind`,
 * where null is general), or deactivates or reactivates it. Body: any of
 * `{ label, required, kind, active }`. ADMIN only; audited. There is no DELETE:
 * items are deactivated, never removed (verification-request 04).
 */
export const PATCH = checklistRoute(async ({ actorId, params, body }) => {
  const item = await editChecklistItem(prisma, {
    actorId,
    itemId: params.id,
    changes: { label: body.label, required: body.required, kind: body.kind, active: body.active },
  });
  return NextResponse.json({ item });
});
