-- Offers move from listings to farms. No real data is expected, so existing
-- offers are deleted rather than backfilled, and every request mid-flow is
-- closed. COMPLETED requests are paid and in delivery, which no runtime path
-- may close, so they are left alone like the finished ones. Unpaid sourced checkouts give back the stock they hold first, then
-- their payments, orders and checkouts are ended, as releaseCheckout does.
UPDATE "Produce" p
SET "floatingQuantity" = p."floatingQuantity" + r.qty
FROM (
  SELECT o."produceId", SUM(o."quantity")::int AS qty
  FROM "Order" o
  JOIN "Checkout" c ON c."id" = o."checkoutId"
  JOIN "SourcingRequest" sr ON sr."id" = c."sourcingRequestId"
  WHERE sr."status" NOT IN ('PENDING', 'COMPLETED', 'FULFILLED', 'CLOSED')
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
  AND sr."status" NOT IN ('PENDING', 'COMPLETED', 'FULFILLED', 'CLOSED')
  AND c."status" = 'AWAITING_PAYMENT'
  AND o."status" = 'AWAITING_PAYMENT';

UPDATE "Payment" pay
SET "status" = 'ABANDONED'
FROM "Checkout" c, "SourcingRequest" sr
WHERE c."id" = pay."checkoutId"
  AND sr."id" = c."sourcingRequestId"
  AND sr."status" NOT IN ('PENDING', 'COMPLETED', 'FULFILLED', 'CLOSED')
  AND c."status" = 'AWAITING_PAYMENT'
  AND pay."status" = 'PENDING';

UPDATE "Checkout" c
SET "status" = 'CANCELLED'
FROM "SourcingRequest" sr
WHERE sr."id" = c."sourcingRequestId"
  AND sr."status" NOT IN ('PENDING', 'COMPLETED', 'FULFILLED', 'CLOSED')
  AND c."status" = 'AWAITING_PAYMENT';

UPDATE "SourcingContract" sc
SET "voidedAt" = now()
FROM "SourcingRequest" sr
WHERE sr."id" = sc."sourcingRequestId"
  AND sr."status" NOT IN ('PENDING', 'COMPLETED', 'FULFILLED', 'CLOSED')
  AND sc."voidedAt" IS NULL;

UPDATE "SourcingRequest"
SET "status" = 'CLOSED', "closedAt" = now(), "closeReason" = 'Closed by sourcing redesign'
WHERE "status" NOT IN ('PENDING', 'COMPLETED', 'FULFILLED', 'CLOSED');

DELETE FROM "SourcingAllocation";

-- The enum swap below cannot cast rows of the dropped value.
DELETE FROM "Notification" WHERE "type" = 'SOURCING_SUPPLY_SHORT';

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('ORDER_RECEIVED', 'ORDER_SHIPPED', 'DISPUTE_RAISED', 'DISPUTE_RESOLVED', 'REFUND_PROCESSED', 'PAYOUT_PAID', 'SOURCING_ASSIGNED', 'SOURCING_UNANSWERED', 'SOURCING_OFFER', 'SOURCING_OFFER_WITHDRAWN', 'SOURCING_CONTRACT_READY', 'SOURCING_PAYMENT_READY');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";
COMMIT;

-- DropIndex
DROP INDEX "SourcingAllocation_sourcingRequestId_produceId_key";

-- AlterTable
ALTER TABLE "SourcingAllocation" ADD COLUMN     "farmId" TEXT NOT NULL,
ADD COLUMN     "unit" "SourcingUnit" NOT NULL,
ALTER COLUMN "produceId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "SourcingAllocation_farmId_idx" ON "SourcingAllocation"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "SourcingAllocation_sourcingRequestId_farmId_key" ON "SourcingAllocation"("sourcingRequestId", "farmId");

-- AddForeignKey
ALTER TABLE "SourcingAllocation" ADD CONSTRAINT "SourcingAllocation_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
