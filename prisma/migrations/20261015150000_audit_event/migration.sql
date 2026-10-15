-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('FARMER', 'EXTENSION_AGENT');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('APPLICATION', 'PROFILE', 'DOCUMENTS', 'FARM', 'LISTING', 'ORDER', 'PAYOUT', 'ONBOARDING', 'VERIFICATION', 'HANDOVER', 'CHAT');

-- CreateEnum
CREATE TYPE "AuditResource" AS ENUM ('FARMER', 'AGENT', 'FARM', 'PRODUCE', 'ORDER', 'PAYOUT', 'CONVERSATION');

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "AuditActorType" NOT NULL,
    "farmerId" TEXT,
    "agentId" TEXT,
    "farmId" TEXT,
    "category" "AuditCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actionLabel" TEXT,
    "resource" "AuditResource",
    "resourceId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_farmerId_occurredAt_idx" ON "AuditEvent"("farmerId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_agentId_occurredAt_idx" ON "AuditEvent"("agentId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_farmId_occurredAt_idx" ON "AuditEvent"("farmId", "occurredAt");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: exactly one actor, matching actorType.
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actor_check" CHECK (
  ("actorType" = 'FARMER' AND "farmerId" IS NOT NULL AND "agentId" IS NULL)
  OR ("actorType" = 'EXTENSION_AGENT' AND "agentId" IS NOT NULL AND "farmerId" IS NULL)
);

-- Hand-written: a link is all present or all absent.
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_link_check" CHECK (
  ("actionLabel" IS NULL AND "resource" IS NULL AND "resourceId" IS NULL)
  OR ("actionLabel" IS NOT NULL AND "resource" IS NOT NULL AND "resourceId" IS NOT NULL)
);
