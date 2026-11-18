-- Safety net, no real data is expected: requests that are neither new nor
-- finished are closed by the enum swap below, so release what they hold first.
-- Unpaid orders give back their reserved stock, then the orders and checkouts
-- are cancelled, then the requests get a close reason.
UPDATE "Produce" p
SET "floatingQuantity" = p."floatingQuantity" + r.qty
FROM (
  SELECT o."produceId", SUM(o."quantity")::int AS qty
  FROM "Order" o
  JOIN "Checkout" c ON c."id" = o."checkoutId"
  JOIN "SourcingRequest" sr ON sr."id" = c."sourcingRequestId"
  WHERE sr."status" NOT IN ('NEW', 'COMPLETED', 'CLOSED')
    AND c."status" = 'AWAITING_PAYMENT'
    AND o."status" = 'AWAITING_PAYMENT'
  GROUP BY o."produceId"
) r
WHERE p."id" = r."produceId";

UPDATE "Order" o
SET "status" = 'CANCELLED', "cancellationReason" = 'Closed by sourcing redesign'
FROM "Checkout" c, "SourcingRequest" sr
WHERE c."id" = o."checkoutId"
  AND sr."id" = c."sourcingRequestId"
  AND sr."status" NOT IN ('NEW', 'COMPLETED', 'CLOSED')
  AND c."status" = 'AWAITING_PAYMENT'
  AND o."status" = 'AWAITING_PAYMENT';

UPDATE "Checkout" c
SET "status" = 'CANCELLED'
FROM "SourcingRequest" sr
WHERE sr."id" = c."sourcingRequestId"
  AND sr."status" NOT IN ('NEW', 'COMPLETED', 'CLOSED')
  AND c."status" = 'AWAITING_PAYMENT';

UPDATE "SourcingRequest"
SET "closedAt" = now(), "closeReason" = 'Closed by sourcing redesign'
WHERE "status" NOT IN ('NEW', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SourcingOfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED');

-- AlterEnum
BEGIN;
CREATE TYPE "SourcingRequestStatus_new" AS ENUM ('PENDING', 'ASSIGNED', 'FINDING_SUPPLY', 'NEGOTIATING', 'CONFIRMED', 'COMPLETED', 'FULFILLED', 'CLOSED');
ALTER TABLE "public"."SourcingRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "SourcingRequest" ALTER COLUMN "status" TYPE "SourcingRequestStatus_new" USING (
  CASE "status"::text
    WHEN 'NEW' THEN 'PENDING'
    WHEN 'COMPLETED' THEN 'FULFILLED'
    ELSE 'CLOSED'
  END::"SourcingRequestStatus_new"
);
ALTER TYPE "SourcingRequestStatus" RENAME TO "SourcingRequestStatus_old";
ALTER TYPE "SourcingRequestStatus_new" RENAME TO "SourcingRequestStatus";
DROP TYPE "public"."SourcingRequestStatus_old";
ALTER TABLE "SourcingRequest" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "Checkout" ADD COLUMN     "deliveryCountry" TEXT NOT NULL DEFAULT 'Nigeria',
ADD COLUMN     "deliveryDateTo" DATE,
ALTER COLUMN "deliveryLga" DROP NOT NULL,
ALTER COLUMN "deliveryState" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "sourcingRequestId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "commissionAgentId" TEXT;

-- AlterTable
ALTER TABLE "SourcingAllocation" ADD COLUMN     "agreedUnitPrice" DECIMAL(12,2),
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "status" "SourcingOfferStatus" NOT NULL DEFAULT 'OFFERED';

-- AlterTable
ALTER TABLE "SourcingRequest" ADD COLUMN     "agreedPrice" DECIMAL(12,2),
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryContactName" TEXT,
ADD COLUMN     "deliveryContactPhone" TEXT,
ADD COLUMN     "deliveryCountry" TEXT,
ADD COLUMN     "deliveryFrom" DATE,
ADD COLUMN     "deliveryLgaId" TEXT,
ADD COLUMN     "deliveryRegion" TEXT,
ADD COLUMN     "deliveryStateId" TEXT,
ADD COLUMN     "deliveryTo" DATE,
ALTER COLUMN "timeline" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "SourcingDecline" (
    "id" TEXT NOT NULL,
    "sourcingRequestId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingDecline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingContract" (
    "id" TEXT NOT NULL,
    "sourcingRequestId" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "agreedPrice" DECIMAL(12,2) NOT NULL,
    "buyerSignedAt" TIMESTAMP(3),
    "agentSignedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcingDecline_sourcingRequestId_idx" ON "SourcingDecline"("sourcingRequestId");

-- CreateIndex
CREATE INDEX "SourcingDecline_agentId_idx" ON "SourcingDecline"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_sourcingRequestId_key" ON "Conversation"("sourcingRequestId");

-- CreateIndex
CREATE INDEX "Order_commissionAgentId_idx" ON "Order"("commissionAgentId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_commissionAgentId_fkey" FOREIGN KEY ("commissionAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingRequest" ADD CONSTRAINT "SourcingRequest_deliveryStateId_fkey" FOREIGN KEY ("deliveryStateId") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingRequest" ADD CONSTRAINT "SourcingRequest_deliveryLgaId_fkey" FOREIGN KEY ("deliveryLgaId") REFERENCES "Lga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingDecline" ADD CONSTRAINT "SourcingDecline_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingDecline" ADD CONSTRAINT "SourcingDecline_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingContract" ADD CONSTRAINT "SourcingContract_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Offers made under the old flow were admin allocations, not farmer offers:
-- keep them as history, closed out.
UPDATE "SourcingAllocation" SET "status" = 'REJECTED';

-- At most one live contract per request; voided ones stay as history.
-- Prisma can't express a partial unique index.
CREATE UNIQUE INDEX "SourcingContract_live_key"
  ON "SourcingContract"("sourcingRequestId") WHERE "voidedAt" IS NULL;

-- A conversation belongs to exactly one subject: an order or a sourcing request.
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_subject_check"
  CHECK (("orderId" IS NULL) <> ("sourcingRequestId" IS NULL));
