-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "phoneNumber" TEXT,
    "agreedToTerms" BOOLEAN NOT NULL DEFAULT false,
    "idType" "IdType",
    "idNumber" TEXT,
    "idDocumentKey" TEXT,
    "farmName" TEXT,
    "stateId" TEXT,
    "lgaId" TEXT,
    "location" TEXT,
    "size" DOUBLE PRECISION,
    "unit" TEXT,
    "mainProduce" TEXT,
    "isExporting" BOOLEAN,
    "referralAgentId" TEXT,
    "ownershipDocumentKey" TEXT,
    "chiefConfirmationKey" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Application_userId_key" ON "Application"("userId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
