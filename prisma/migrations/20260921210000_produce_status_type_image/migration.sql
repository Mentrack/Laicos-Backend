-- CreateEnum
CREATE TYPE "ProduceStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "ProduceType" AS ENUM ('LOCAL', 'EXPORT');

-- AlterTable
ALTER TABLE "Produce" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "status" "ProduceStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "type" "ProduceType" NOT NULL DEFAULT 'LOCAL';

