-- Traffic Source on Donation (ticket 24): the `src` a shared link carried,
-- sanitized before it ever reaches this column (src/lib/traffic-source.ts).
ALTER TABLE "Donation" ADD COLUMN "trafficSource" VARCHAR(40);
