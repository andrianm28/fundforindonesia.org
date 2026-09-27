/**
 * Recognising a Prisma error by the code it carries, rather than by its
 * message.
 *
 * Two callers need the same answer -- "did the database refuse this write
 * because of a constraint?" -- and both need it to be one answer: a second
 * copy of this predicate is a second thing to keep in step with Prisma's error
 * shape. Matched on `code` alone, because that is the part Prisma documents
 * and the part that does not shift with wording.
 */
export function isPrismaUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
