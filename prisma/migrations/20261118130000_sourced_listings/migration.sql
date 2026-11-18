-- AlterEnum
ALTER TYPE "ProduceStatus" ADD VALUE 'SOURCED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "sourced" BOOLEAN NOT NULL DEFAULT false;
