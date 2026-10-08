-- Agents now get no access until an admin verifies them. Those who
-- registered before this rule already use the app; keep them in.
UPDATE "User" SET "activatedAt" = "createdAt"
WHERE "role" = 'EXTENSION_AGENT' AND "activatedAt" IS NULL;
