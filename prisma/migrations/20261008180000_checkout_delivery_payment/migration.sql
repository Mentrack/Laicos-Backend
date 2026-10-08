-- Hand-written: backs Payment.reference's default, like Checkout's CHK- sequence.
CREATE SEQUENCE "Payment_reference_seq";

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STUB');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_PAYMENT' BEFORE 'PENDING';

-- AlterTable
ALTER TABLE "Checkout" ADD COLUMN     "deliveryContactName" TEXT,
ADD COLUMN     "deliveryContactPhone" TEXT,
ADD COLUMN     "deliveryDate" DATE NOT NULL,
ADD COLUMN     "deliveryFee" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "deliveryLabel" TEXT NOT NULL,
ADD COLUMN     "deliveryLga" TEXT NOT NULL,
ADD COLUMN     "deliveryState" TEXT NOT NULL,
ADD COLUMN     "deliveryStreet" TEXT NOT NULL,
ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "status" "CheckoutStatus" NOT NULL,
ADD COLUMN     "subtotal" DECIMAL(12,2) NOT NULL;

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "lgaId" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT ('PAY-'::text || lpad((nextval('"Payment_reference_seq"'::regclass))::text, 6, '0'::text)),
    "checkoutId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "providerData" JSONB,
    "confirmedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Address_buyerId_idx" ON "Address"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_checkoutId_idempotencyKey_key" ON "Payment"("checkoutId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Checkout_status_expiresAt_idx" ON "Checkout"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_lgaId_fkey" FOREIGN KEY ("lgaId") REFERENCES "Lga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "Checkout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma can't express partial indexes.
-- One default address per buyer.
CREATE UNIQUE INDEX "Address_buyerId_default_key" ON "Address" ("buyerId") WHERE "isDefault";
-- One successful payment per checkout.
CREATE UNIQUE INDEX "Payment_checkoutId_succeeded_key" ON "Payment" ("checkoutId") WHERE "status" = 'SUCCEEDED';

ALTER SEQUENCE "Payment_reference_seq" OWNED BY "Payment"."reference";
