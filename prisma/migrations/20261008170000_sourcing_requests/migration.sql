-- Hand-written: backs SourcingRequest.requestNumber's default, like Order's ORD- sequence.
CREATE SEQUENCE "SourcingRequest_requestNumber_seq";

-- CreateEnum
CREATE TYPE "SourcingUnit" AS ENUM ('KG', 'TONNES', 'BAGS', 'CRATES', 'BASKETS', 'LITRES', 'PIECES');

-- CreateEnum
CREATE TYPE "QualityGrade" AS ENUM ('GRADE_A', 'GRADE_B', 'GRADE_C', 'MIXED');

-- CreateEnum
CREATE TYPE "PackagingType" AS ENUM ('BAGS', 'SACKS', 'CRATES', 'CARTONS', 'BULK', 'OTHER');

-- CreateEnum
CREATE TYPE "ProduceCondition" AS ENUM ('FRESH', 'DRIED', 'PROCESSED', 'FROZEN');

-- CreateEnum
CREATE TYPE "SourcingTimeline" AS ENUM ('WITHIN_1_WEEK', 'WITHIN_2_WEEKS', 'WITHIN_1_MONTH', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "SourcingRequestStatus" AS ENUM ('UNDER_REVIEW');

-- CreateTable
CREATE TABLE "SourcingRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL DEFAULT ('REQ-'::text || lpad((nextval('"SourcingRequest_requestNumber_seq"'::regclass))::text, 6, '0'::text)),
    "buyerId" TEXT NOT NULL,
    "produceName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "SourcingUnit" NOT NULL,
    "quality" "QualityGrade" NOT NULL,
    "packaging" "PackagingType" NOT NULL,
    "condition" "ProduceCondition" NOT NULL,
    "additionalSpecs" TEXT,
    "deliveryDestination" TEXT NOT NULL,
    "requiredDate" DATE NOT NULL,
    "timeline" "SourcingTimeline" NOT NULL,
    "logisticsNotes" TEXT,
    "status" "SourcingRequestStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourcingRequest_requestNumber_key" ON "SourcingRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "SourcingRequest_buyerId_createdAt_idx" ON "SourcingRequest"("buyerId", "createdAt");

-- AddForeignKey
ALTER TABLE "SourcingRequest" ADD CONSTRAINT "SourcingRequest_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: drop the sequence with the column.
ALTER SEQUENCE "SourcingRequest_requestNumber_seq" OWNED BY "SourcingRequest"."requestNumber";
