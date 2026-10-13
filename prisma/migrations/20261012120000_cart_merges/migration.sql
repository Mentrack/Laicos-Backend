-- CreateTable
CREATE TABLE "CartMerge" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "skipped" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CartMerge_buyerId_idempotencyKey_key" ON "CartMerge"("buyerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CartMerge" ADD CONSTRAINT "CartMerge_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

