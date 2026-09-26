import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { moveChecklistItem } from "@/lib/verification-checklist";
import { checklistRoute } from "@/lib/verification-checklist-route";

/**
 * POST /api/admin/verification-checklist/[id]/move: swaps the item with its
 * neighbour. Body: `{ direction: "up" | "down" }`. Answers every item in the
 * new order. ADMIN only; audited (verification-request 04).
 */
export const POST = checklistRoute(async ({ actorId, params, body }) => {
  const items = await moveChecklistItem(prisma, { actorId, itemId: params.id, direction: body.direction });
  return NextResponse.json({ items });
});
