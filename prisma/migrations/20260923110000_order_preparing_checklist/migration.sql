-- AlterEnum

ALTER TYPE "OrderStatus" ADD VALUE 'PREPARING';
ALTER TYPE "OrderStatus" ADD VALUE 'SHIPPED';

-- CreateTable
CREATE TABLE "OrderChecklist" (
    "orderId" TEXT NOT NULL,
    "harvested" BOOLEAN NOT NULL DEFAULT false,
    "sorted" BOOLEAN NOT NULL DEFAULT false,
    "packaged" BOOLEAN NOT NULL DEFAULT false,
    "readyForPickup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderChecklist_pkey" PRIMARY KEY ("orderId")
);

-- AddForeignKey
ALTER TABLE "OrderChecklist" ADD CONSTRAINT "OrderChecklist_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

