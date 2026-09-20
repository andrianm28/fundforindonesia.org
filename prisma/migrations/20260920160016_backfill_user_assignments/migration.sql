-- Backfill assignments from the Role rank each user holds.
-- ADMIN gains both assignments; MODERATOR gains Verifier.
INSERT INTO "UserAssignment" ("userId", "assignment")
SELECT "id", 'VERIFIER' FROM "User" WHERE "role" = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO "UserAssignment" ("userId", "assignment")
SELECT "id", 'ADMIN' FROM "User" WHERE "role" = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO "UserAssignment" ("userId", "assignment")
SELECT "id", 'VERIFIER' FROM "User" WHERE "role" = 'MODERATOR'
ON CONFLICT DO NOTHING;
