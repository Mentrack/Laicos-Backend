-- Cluster.clusterCode: public code (CL-000123) from a hand-made sequence, like Farm.farmCode.
CREATE SEQUENCE "Cluster_clusterCode_seq";

ALTER TABLE "Cluster" ADD COLUMN "clusterCode" TEXT;

-- Number existing clusters in creation order so codes follow it, then move the
-- sequence past them (is_called=false when there are none, so the first new one is 1).
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS n FROM "Cluster"
)
UPDATE "Cluster" c
SET "clusterCode" = 'CL-' || lpad(numbered.n::text, 6, '0')
FROM numbered
WHERE c.id = numbered.id;

SELECT setval(
  '"Cluster_clusterCode_seq"',
  COALESCE((SELECT COUNT(*) FROM "Cluster"), 0) + 1,
  false
);

ALTER TABLE "Cluster"
  ALTER COLUMN "clusterCode" SET DEFAULT ('CL-'::text || lpad((nextval('"Cluster_clusterCode_seq"'::regclass))::text, 6, '0'::text)),
  ALTER COLUMN "clusterCode" SET NOT NULL;

CREATE UNIQUE INDEX "Cluster_clusterCode_key" ON "Cluster"("clusterCode");

ALTER SEQUENCE "Cluster_clusterCode_seq" OWNED BY "Cluster"."clusterCode";

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "orderId" TEXT;

-- CreateIndex
CREATE INDEX "AuditEvent_orderId_occurredAt_idx" ON "AuditEvent"("orderId", "occurredAt");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill so existing orders keep their history in the per-order audit trail.
UPDATE "AuditEvent" SET "orderId" = "resourceId"
WHERE "resource" = 'ORDER' AND "resourceId" IN (SELECT id FROM "Order");

UPDATE "AuditEvent" a SET "orderId" = d."orderId"
FROM "Dispute" d
WHERE a."resource" = 'DISPUTE' AND a."resourceId" = d.id;
