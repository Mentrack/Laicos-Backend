-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "bankStatementKey" TEXT,
ADD COLUMN     "organisation" TEXT,
ADD COLUMN     "professionalCertificateKey" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "bankStatementKey" TEXT,
ADD COLUMN     "organisation" TEXT,
ADD COLUMN     "professionalCertificateKey" TEXT;

