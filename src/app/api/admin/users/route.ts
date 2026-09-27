import { NextRequest, NextResponse } from "next/server";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { lookupUserEmail, readUserEmail, SELECT_USER_EMAIL } from "@/lib/contact-fields";
import { prisma } from "@/lib/prisma";

export const GET = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "10", 10)));
  const search = searchParams.get("search") || undefined;

  const skip = (page - 1) * limit;

  // A name is plaintext and searchable as a substring (ADR 0012 keeps names
  // readable). An address is not: it is a randomized ciphertext with a
  // deterministic HMAC beside it, and a deterministic value can only be looked
  // up by equality, never matched on a fragment. So a search that is an address
  // finds that one account, and anything else searches names. Decrypting every
  // account to run a substring match would be exactly what the scheme exists to
  // prevent, and it is the Admin list here, not a rare report.
  const isAddress = search !== undefined && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(search.trim());
  const where = isAddress
    ? lookupUserEmail(search.trim())
    : search
      ? { name: { contains: search, mode: "insensitive" as const } }
      : undefined;

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        createdAt: true,
        ...SELECT_USER_EMAIL,
        assignments: { select: { assignment: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({ where }),
  ]);

  // Assignments are the only thing that grants power (ADR 0005), so they are
  // what the Admin sees and edits for each user. Each field is named rather
  // than spread: the address is decrypted for the panel, and the ciphertext and
  // lookup columns the query read must not travel to a browser, which is the
  // whole point of storing them.
  const users = rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    email: readUserEmail(row),
    assignments: row.assignments.map((a) => a.assignment),
  }));

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  });
});
