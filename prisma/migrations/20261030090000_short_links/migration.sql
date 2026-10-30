-- Short links per Campaign (ticket E1/02, PRD FFI-06; owner decision
-- 2026-10-04: a prefix on the apex domain, `/s/<code>`). A new table only:
-- no existing row is touched, so there is nothing to backfill.

-- CreateTable
CREATE TABLE "ShortLink" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShortLink_code_key" ON "ShortLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShortLink_campaignId_source_key" ON "ShortLink"("campaignId", "source");

-- AddForeignKey
ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
