-- AlterTable
ALTER TABLE "Farm" ADD COLUMN     "isExporting" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mainProduce" TEXT,
ADD COLUMN     "referralAgentId" TEXT,
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'ha';

-- Backfill existing rows before enforcing NOT NULL below.
UPDATE "Farm" SET "mainProduce" = 'Unspecified' WHERE "mainProduce" IS NULL;

ALTER TABLE "Farm" ALTER COLUMN "mainProduce" SET NOT NULL;
