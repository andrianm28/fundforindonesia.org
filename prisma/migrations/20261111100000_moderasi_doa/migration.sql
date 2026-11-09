-- Moderasi doa (PKS pemenuhan 10, pasal 3.7c).
--
-- Prayer gets a hide flag and a soft delete, each with who and when:
--   hidden / hiddenAt / hiddenById    set together by a Verifier or Admin,
--                                     cleared together when shown again
--   deletedAt / deletedById           soft delete, never cleared
-- Every existing Prayer stays visible (hidden DEFAULT false, the rest NULL).
-- The two "by" columns are plain text, not foreign keys: the record of who
-- moderated must outlive that account, which SetNull would erase.
--
-- No new index. The public reads (Campaign page, Prayer Wall) filter on
-- "hidden" = false AND "deletedAt" IS NULL on top of the existing
-- "campaignId" and "createdAt" indexes, which already do the selecting and
-- the ordering; the two extra predicates only discard the (few) moderated
-- rows from rows already read in index order.

-- AlterTable
ALTER TABLE "Prayer" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenById" TEXT;
