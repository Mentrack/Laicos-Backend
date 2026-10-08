-- Farmers get no access until their first farm is verified.
ALTER TABLE "User" ADD COLUMN "activatedAt" TIMESTAMP(3);

-- Farmers who registered before this rule already use the app; keep them in.
UPDATE "User" SET "activatedAt" = "createdAt" WHERE "role" = 'FARMER';
