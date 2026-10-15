-- CreateEnum
CREATE TYPE "FarmerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "Farmer" ADD COLUMN "status" "FarmerStatus" NOT NULL DEFAULT 'ACTIVE';
