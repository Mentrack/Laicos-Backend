-- Buyer kind. Existing buyers are persons; company columns stay null.
CREATE TYPE "BuyerType" AS ENUM ('PERSON', 'COMPANY');

ALTER TABLE "Buyer"
  ADD COLUMN "buyerType" "BuyerType" NOT NULL DEFAULT 'PERSON',
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "paymentTerms" TEXT;

ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_company_fields_check" CHECK (
  (
    "buyerType" = 'PERSON'
    AND "legalName" IS NULL
    AND "department" IS NULL
    AND "contactName" IS NULL
    AND "contactPhone" IS NULL
    AND "paymentTerms" IS NULL
  )
  OR (
    "buyerType" = 'COMPANY'
    AND "legalName" IS NOT NULL AND length(btrim("legalName")) > 0
    AND "department" IS NOT NULL AND length(btrim("department")) > 0
    AND "contactName" IS NOT NULL AND length(btrim("contactName")) > 0
    AND "contactPhone" IS NOT NULL AND length(btrim("contactPhone")) > 0
    AND "paymentTerms" IS NOT NULL AND length(btrim("paymentTerms")) > 0
  )
);

-- Replace UNDER_REVIEW with the admin lifecycle. Existing rows become NEW.
CREATE TYPE "SourcingRequestStatus_new" AS ENUM (
  'NEW',
  'IN_REVIEW',
  'FINDING_SUPPLY',
  'AWAITING_BUYER',
  'CONFIRMED',
  'FULFILMENT',
  'COMPLETED',
  'CLOSED'
);

ALTER TABLE "SourcingRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "SourcingRequest"
  ALTER COLUMN "status" TYPE "SourcingRequestStatus_new"
  USING (
    CASE "status"::text
      WHEN 'UNDER_REVIEW' THEN 'NEW'
      ELSE "status"::text
    END
  )::"SourcingRequestStatus_new";
DROP TYPE "SourcingRequestStatus";
ALTER TYPE "SourcingRequestStatus_new" RENAME TO "SourcingRequestStatus";
ALTER TABLE "SourcingRequest" ALTER COLUMN "status" SET DEFAULT 'NEW';

ALTER TABLE "SourcingRequest"
  ADD COLUMN "assignedAgentId" TEXT,
  ADD COLUMN "escalatedAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closeReason" TEXT;

ALTER TABLE "SourcingRequest"
  ADD CONSTRAINT "SourcingRequest_assignedAgentId_fkey"
  FOREIGN KEY ("assignedAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "SourcingRequest_status_createdAt_idx" ON "SourcingRequest"("status", "createdAt");
CREATE INDEX "SourcingRequest_assignedAgentId_idx" ON "SourcingRequest"("assignedAgentId");

CREATE TABLE "SourcingAllocation" (
  "id" TEXT NOT NULL,
  "sourcingRequestId" TEXT NOT NULL,
  "produceId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "SourcingAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourcingAllocation_sourcingRequestId_produceId_key"
  ON "SourcingAllocation"("sourcingRequestId", "produceId");
CREATE INDEX "SourcingAllocation_produceId_idx" ON "SourcingAllocation"("produceId");

ALTER TABLE "SourcingAllocation"
  ADD CONSTRAINT "SourcingAllocation_sourcingRequestId_fkey"
  FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SourcingAllocation_produceId_fkey"
  FOREIGN KEY ("produceId") REFERENCES "Produce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Checkout" ADD COLUMN "sourcingRequestId" TEXT;

ALTER TABLE "Checkout"
  ADD CONSTRAINT "Checkout_sourcingRequestId_fkey"
  FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Checkout_sourcingRequestId_idx" ON "Checkout"("sourcingRequestId");

-- One open payment hold per request. Prisma cannot express the filter.
CREATE UNIQUE INDEX "Checkout_sourcingRequestId_awaiting_key"
  ON "Checkout"("sourcingRequestId")
  WHERE "status" = 'AWAITING_PAYMENT' AND "sourcingRequestId" IS NOT NULL;

ALTER TYPE "AuditActorType" ADD VALUE 'ADMIN';
ALTER TYPE "AuditActorType" ADD VALUE 'BUYER';
ALTER TYPE "AuditActorType" ADD VALUE 'SYSTEM';

ALTER TYPE "AuditCategory" ADD VALUE 'SOURCING';
ALTER TYPE "AuditCategory" ADD VALUE 'ASSIGNMENT';
ALTER TYPE "AuditCategory" ADD VALUE 'MATCHING';

ALTER TYPE "AuditResource" ADD VALUE 'SOURCING_REQUEST';
ALTER TYPE "AuditResource" ADD VALUE 'CHECKOUT';

ALTER TABLE "AuditEvent" ADD COLUMN "sourcingRequestId" TEXT;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_sourcingRequestId_fkey"
  FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AuditEvent_sourcingRequestId_occurredAt_idx"
  ON "AuditEvent"("sourcingRequestId", "occurredAt");
