-- Location on Campaign (ticket 25, "Impact & Transparency"), so the public
-- Impact page's location filter has a column to filter on. Additive and
-- nullable: no backfill, and no application code writes it yet -- the
-- campaign form that will (FFI-02 / FFI-04, Fase 1) is out of this ticket's
-- scope, so every existing and new Campaign reads as "location not recorded"
-- until then. src/lib/money/impact.ts filters on it, never invents a value.
ALTER TABLE "Campaign" ADD COLUMN "location" TEXT;

-- CreateIndex
CREATE INDEX "Campaign_location_idx" ON "Campaign"("location");
