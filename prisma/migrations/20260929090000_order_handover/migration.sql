-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('PENDING', 'VERIFIED', 'HANDED_OVER');

-- CreateTable
CREATE TABLE "OrderHandover" (
    "orderId" TEXT NOT NULL,
    "agentId" TEXT,
    "status" "HandoverStatus" NOT NULL DEFAULT 'PENDING',
    "verificationNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "handoverNote" TEXT,
    "handedOverAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderHandover_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE INDEX "OrderHandover_agentId_status_idx" ON "OrderHandover"("agentId", "status");

-- AddForeignKey
ALTER TABLE "OrderHandover" ADD CONSTRAINT "OrderHandover_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderHandover" ADD CONSTRAINT "OrderHandover_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written backfill: orders already READY get their handover, assigned to
-- the agent whose cluster holds the farm (NULL when it is in none).
INSERT INTO "OrderHandover" ("orderId", "agentId", "updatedAt")
SELECT o."id", c."agentId", CURRENT_TIMESTAMP
FROM "Order" o
JOIN "Farm" f ON f."id" = o."farmId"
LEFT JOIN "Cluster" c ON c."id" = f."clusterId"
WHERE o."status" = 'READY';
