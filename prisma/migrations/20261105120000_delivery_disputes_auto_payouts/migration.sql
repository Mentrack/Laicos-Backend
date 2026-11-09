-- CreateEnum
CREATE TYPE "PayeeRole" AS ENUM ('FARMER', 'AGENT');

-- CreateEnum
CREATE TYPE "PayoutItemKind" AS ENUM ('PRODUCE', 'COMMISSION');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterEnum
ALTER TYPE "AuditCategory" ADD VALUE 'DISPUTE';

-- AlterEnum
ALTER TYPE "AuditResource" ADD VALUE 'DISPUTE';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_SHIPPED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_RAISED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_PROCESSED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_PAID';

-- AlterTable
-- Hand-written: the temporary default backfills existing rows; they charged no commission.
ALTER TABLE "Checkout" ADD COLUMN     "agentCommission" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Checkout" ALTER COLUMN "agentCommission" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "agentCommission" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ALTER COLUMN "agentCommission" DROP DEFAULT;

-- Hand-written: FarmerBankAccount becomes BankAccount keyed by the farmer's
-- User.id, keeping every existing row instead of the diff's drop-and-create.
ALTER TABLE "FarmerBankAccount" DROP CONSTRAINT "FarmerBankAccount_farmerId_fkey";
ALTER TABLE "FarmerBankAccount" DROP CONSTRAINT "FarmerBankAccount_setById_fkey";
ALTER TABLE "FarmerBankAccount" RENAME TO "BankAccount";
ALTER TABLE "BankAccount" RENAME CONSTRAINT "FarmerBankAccount_pkey" TO "BankAccount_pkey";
ALTER TABLE "BankAccount" ADD COLUMN "userId" TEXT;
UPDATE "BankAccount" b SET "userId" = f."userId" FROM "Farmer" f WHERE f."id" = b."farmerId";
ALTER TABLE "BankAccount" ALTER COLUMN "userId" SET NOT NULL;
DROP INDEX "FarmerBankAccount_farmerId_key";
ALTER TABLE "BankAccount" DROP COLUMN "farmerId";

-- Hand-written: Payout.farmerId becomes payeeId (the farmer's User.id) with
-- role FARMER, backfilled before the columns turn NOT NULL.
ALTER TABLE "Payout" DROP CONSTRAINT "Payout_farmerId_fkey";
DROP INDEX "Payout_farmerId_status_idx";
ALTER TABLE "Payout" ADD COLUMN     "payeeId" TEXT,
ADD COLUMN     "payeeRole" "PayeeRole",
ALTER COLUMN "approvedById" DROP NOT NULL;
UPDATE "Payout" p SET "payeeId" = f."userId", "payeeRole" = 'FARMER' FROM "Farmer" f WHERE f."id" = p."farmerId";
ALTER TABLE "Payout" ALTER COLUMN "payeeId" SET NOT NULL,
ALTER COLUMN "payeeRole" SET NOT NULL;
ALTER TABLE "Payout" DROP COLUMN "farmerId";

-- AlterTable
-- Hand-written: every existing item paid a farmer for produce.
ALTER TABLE "PayoutItem" ADD COLUMN     "kind" "PayoutItemKind" NOT NULL DEFAULT 'PRODUCE';
ALTER TABLE "PayoutItem" ALTER COLUMN "kind" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "disputeId" TEXT;

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "quantityAffected" INTEGER NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "refundPercent" DECIMAL(5,2),
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputePhoto" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_userId_key" ON "BankAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_orderId_key" ON "Dispute"("orderId");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DisputePhoto_disputeId_idx" ON "DisputePhoto"("disputeId");

-- CreateIndex
CREATE INDEX "Payout_payeeId_status_idx" ON "Payout"("payeeId", "status");

-- CreateIndex
CREATE INDEX "Refund_disputeId_idx" ON "Refund"("disputeId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputePhoto" ADD CONSTRAINT "DisputePhoto_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: Prisma can't express partial indexes.
-- An order has at most one live payout item per kind: one farmer payment and
-- one agent payment.
DROP INDEX "PayoutItem_orderId_active_key";
CREATE UNIQUE INDEX "PayoutItem_orderId_kind_active_key" ON "PayoutItem" ("orderId", "kind") WHERE "status" IN ('PENDING', 'SUCCEEDED');
