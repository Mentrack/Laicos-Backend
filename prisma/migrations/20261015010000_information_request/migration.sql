-- The note an admin sends when asking the assigned agent for missing documents.
ALTER TABLE "FarmVerification"
  ADD COLUMN "informationRequestNote" TEXT,
  ADD COLUMN "informationRequestedAt" TIMESTAMP(3);
