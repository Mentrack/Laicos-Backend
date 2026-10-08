-- Temporary: ownership documents are optional at farm creation for now.
-- Restoring NOT NULL later needs existing NULL rows backfilled first.
ALTER TABLE "Farm" ALTER COLUMN "ownershipDocumentKey" DROP NOT NULL;
