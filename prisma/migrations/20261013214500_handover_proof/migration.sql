-- Photos an agent takes as proof of the goods at handover.
CREATE TABLE "HandoverProof" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HandoverProof_orderId_idx" ON "HandoverProof"("orderId");

ALTER TABLE "HandoverProof" ADD CONSTRAINT "HandoverProof_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderHandover"("orderId") ON DELETE CASCADE ON UPDATE CASCADE;
