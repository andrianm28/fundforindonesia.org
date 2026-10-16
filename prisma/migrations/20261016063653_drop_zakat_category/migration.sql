-- Data only, no schema change. Zakat is out of scope (ADR 0025, PR #251), but
-- production still holds the "zakat" Category from an early seed, so it kept
-- showing in search filters, the Campaign form and /explore/zakat. Without the
-- row /explore/zakat is a 404 and the sitemap drops it.
--
-- Campaign.category is free text with no foreign key, so the two seed sample
-- Campaigns that carry "zakat" keep reading; an Admin suspends them through
-- the Admin screen instead (owner decision 2026-10-16). Platform Fee rules are
-- append-only history and are left as they are. Re-running is a no-op.

DELETE FROM "Category" WHERE "slug" = 'zakat';
