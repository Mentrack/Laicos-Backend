-- Hand-written: backs Checkout.checkoutNumber's default, like Order's ORD- sequence.
CREATE SEQUENCE "Checkout_checkoutNumber_seq";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkoutId" TEXT;

-- AlterTable
ALTER TABLE "Produce" ADD COLUMN     "description" TEXT,
ADD COLUMN     "specs" TEXT;

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "produceId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkout" (
    "id" TEXT NOT NULL,
    "checkoutNumber" TEXT NOT NULL DEFAULT ('CHK-'::text || lpad((nextval('"Checkout_checkoutNumber_seq"'::regclass))::text, 6, '0'::text)),
    "buyerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_buyerId_produceId_key" ON "CartItem"("buyerId", "produceId");

-- CreateIndex
CREATE UNIQUE INDEX "Checkout_checkoutNumber_key" ON "Checkout"("checkoutNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Checkout_buyerId_idempotencyKey_key" ON "Checkout"("buyerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_checkoutId_idx" ON "Order"("checkoutId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "Checkout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_produceId_fkey" FOREIGN KEY ("produceId") REFERENCES "Produce"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER SEQUENCE "Checkout_checkoutNumber_seq" OWNED BY "Checkout"."checkoutNumber";
