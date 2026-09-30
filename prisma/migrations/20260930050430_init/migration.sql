-- Hand-written: back the farmerId/farmCode/agentId/orderNumber defaults.
-- Prisma doesn't model sequences, so migrate diff omits them.
CREATE SEQUENCE "Farmer_farmerId_seq";
CREATE SEQUENCE "Farm_farmCode_seq";
CREATE SEQUENCE "Agent_agentId_seq";
CREATE SEQUENCE "Order_orderNumber_seq";

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('PENDING', 'VERIFIED', 'HANDED_OVER');

-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('NIN', 'VOTERS_CARD');

-- CreateEnum
CREATE TYPE "FarmVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationTaskStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('VERIFIED', 'ISSUE', 'UNABLE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "VerificationCheckKey" AS ENUM ('FARMER_ID', 'FARM_OWNERSHIP', 'CHIEF_CONFIRMATION', 'FARM_ACTIVE', 'ACCESS_ROUTE', 'MEASUREMENTS', 'DECLARED_PRODUCE', 'CROP_HEALTH', 'ESTIMATED_YIELD');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('CHECK', 'LOCATION_DISCREPANCY', 'PHOTO');

-- CreateEnum
CREATE TYPE "PhotoSlot" AS ENUM ('ENTRANCE', 'FARM_AREA', 'PRODUCE', 'INFRASTRUCTURE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SHIPPED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProduceStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "ProduceType" AS ENUM ('LOCAL', 'EXPORT');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FARMER', 'BUYER', 'EXTENSION_AGENT', 'RIDER', 'ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firebaseUid" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "role" "Role" NOT NULL,
    "agreedToTerms" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Farmer" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL DEFAULT ('FRM-'::text || lpad((nextval('"Farmer_farmerId_seq"'::regclass))::text, 6, '0'::text)),
    "userId" TEXT NOT NULL,
    "idType" "IdType",
    "idNumber" TEXT,
    "idDocumentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Farmer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Farm" (
    "id" TEXT NOT NULL,
    "farmCode" TEXT NOT NULL DEFAULT ('LF-'::text || lpad((nextval('"Farm_farmCode_seq"'::regclass))::text, 6, '0'::text)),
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "stateId" TEXT NOT NULL,
    "lgaId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'ha',
    "mainProduce" TEXT NOT NULL,
    "isExporting" BOOLEAN NOT NULL DEFAULT false,
    "ownershipDocumentKey" TEXT NOT NULL,
    "chiefConfirmationKey" TEXT,
    "verificationStatus" "FarmVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "isClustered" BOOLEAN NOT NULL DEFAULT false,
    "clusterId" TEXT,
    "referralAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Farm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "State" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lga" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Lga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL DEFAULT ('AG-'::text || lpad((nextval('"Agent_agentId_seq"'::regclass))::text, 6, '0'::text)),
    "userId" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "stateId" TEXT,
    "lgaId" TEXT,
    "idType" "IdType",
    "idNumber" TEXT,
    "idDocumentKey" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmVerification" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "agentId" TEXT,
    "status" "VerificationTaskStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "locationMatches" BOOLEAN,
    "discrepancyLat" DECIMAL(9,6),
    "discrepancyLng" DECIMAL(9,6),
    "discrepancyNote" TEXT,
    "identityNote" TEXT,
    "measuredSize" DOUBLE PRECISION,
    "estimatedYield" DOUBLE PRECISION,
    "estimatedYieldUnit" TEXT,
    "generalNote" TEXT,
    "rejectionReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCheck" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "key" "VerificationCheckKey" NOT NULL,
    "result" "CheckResult" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEvidence" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "checkKey" "VerificationCheckKey",
    "photoSlot" "PhotoSlot",
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentDecline" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentDecline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produce" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "actualQuantity" DOUBLE PRECISION NOT NULL,
    "floatingQuantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "pricePerUnit" DECIMAL(12,2) NOT NULL,
    "imageUrl" TEXT,
    "status" "ProduceStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "ProduceType" NOT NULL DEFAULT 'LOCAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL DEFAULT ('ORD-'::text || lpad((nextval('"Order_orderNumber_seq"'::regclass))::text, 6, '0'::text)),
    "produceId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "produceName" TEXT NOT NULL,
    "type" "ProduceType" NOT NULL,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "OrderHandover" (
    "orderId" TEXT NOT NULL,
    "agentId" TEXT,
    "status" "HandoverStatus" NOT NULL DEFAULT 'PENDING',
    "verificationNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "handoverNote" TEXT,
    "handedOverAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderHandover_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_userId_key" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Farmer_farmerId_key" ON "Farmer"("farmerId");

-- CreateIndex
CREATE UNIQUE INDEX "Farmer_userId_key" ON "Farmer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Farm_farmCode_key" ON "Farm"("farmCode");

-- CreateIndex
CREATE INDEX "Farm_ownerId_idx" ON "Farm"("ownerId");

-- CreateIndex
CREATE INDEX "Farm_lgaId_idx" ON "Farm"("lgaId");

-- CreateIndex
CREATE INDEX "Farm_clusterId_idx" ON "Farm"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "State_name_key" ON "State"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Lga_stateId_name_key" ON "Lga"("stateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_agentId_key" ON "Agent"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_userId_key" ON "Agent"("userId");

-- CreateIndex
CREATE INDEX "Agent_lgaId_isVerified_idx" ON "Agent"("lgaId", "isVerified");

-- CreateIndex
CREATE UNIQUE INDEX "Cluster_agentId_key" ON "Cluster"("agentId");

-- CreateIndex
CREATE INDEX "FarmVerification_farmId_idx" ON "FarmVerification"("farmId");

-- CreateIndex
CREATE INDEX "FarmVerification_agentId_status_idx" ON "FarmVerification"("agentId", "status");

-- CreateIndex
CREATE INDEX "FarmVerification_status_idx" ON "FarmVerification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationCheck_verificationId_key_key" ON "VerificationCheck"("verificationId", "key");

-- CreateIndex
CREATE INDEX "VerificationEvidence_verificationId_idx" ON "VerificationEvidence"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentDecline_verificationId_agentId_key" ON "AssignmentDecline"("verificationId", "agentId");

-- CreateIndex
CREATE INDEX "Produce_farmId_idx" ON "Produce"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "Produce_id_farmId_key" ON "Produce"("id", "farmId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_farmId_idx" ON "Order"("farmId");

-- CreateIndex
CREATE INDEX "Order_produceId_idx" ON "Order"("produceId");

-- CreateIndex
CREATE INDEX "Order_buyerId_idx" ON "Order"("buyerId");

-- CreateIndex
CREATE INDEX "OrderHandover_agentId_status_idx" ON "OrderHandover"("agentId", "status");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farmer" ADD CONSTRAINT "Farmer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Farmer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_lgaId_fkey" FOREIGN KEY ("lgaId") REFERENCES "Lga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_referralAgentId_fkey" FOREIGN KEY ("referralAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lga" ADD CONSTRAINT "Lga_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_lgaId_fkey" FOREIGN KEY ("lgaId") REFERENCES "Lga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmVerification" ADD CONSTRAINT "FarmVerification_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmVerification" ADD CONSTRAINT "FarmVerification_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCheck" ADD CONSTRAINT "VerificationCheck_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "FarmVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "FarmVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentDecline" ADD CONSTRAINT "AssignmentDecline_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "FarmVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentDecline" ADD CONSTRAINT "AssignmentDecline_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produce" ADD CONSTRAINT "Produce_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_produceId_farmId_fkey" FOREIGN KEY ("produceId", "farmId") REFERENCES "Produce"("id", "farmId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChecklist" ADD CONSTRAINT "OrderChecklist_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderHandover" ADD CONSTRAINT "OrderHandover_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderHandover" ADD CONSTRAINT "OrderHandover_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: tie the sequences' lifetime to their columns.
ALTER SEQUENCE "Farmer_farmerId_seq" OWNED BY "Farmer"."farmerId";
ALTER SEQUENCE "Farm_farmCode_seq" OWNED BY "Farm"."farmCode";
ALTER SEQUENCE "Agent_agentId_seq" OWNED BY "Agent"."agentId";
ALTER SEQUENCE "Order_orderNumber_seq" OWNED BY "Order"."orderNumber";

-- Hand-written: Prisma doesn't model CHECK constraints. They back up the
-- conditional stock updates in OrderService, so a missed guard fails loudly
-- instead of overselling.
ALTER TABLE "Produce" ADD CONSTRAINT "Produce_floatingQuantity_nonnegative" CHECK ("floatingQuantity" >= 0),
ADD CONSTRAINT "Produce_floating_within_actual" CHECK ("floatingQuantity" <= "actualQuantity");

-- Hand-written: at most one open verification round per farm. Prisma can't
-- express a partial unique index.
CREATE UNIQUE INDEX "FarmVerification_farmId_open_key" ON "FarmVerification"("farmId")
WHERE "status" IN ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS');

-- Hand-written: a check evidence names its check and nothing else carries one;
-- likewise a photo and its slot.
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_shape_check" CHECK (
    ("kind" = 'CHECK') = ("checkKey" IS NOT NULL)
    AND ("kind" = 'PHOTO') = ("photoSlot" IS NOT NULL)
);

-- Hand-written seed: Nigeria's 36 states + FCT and 774 LGAs, from the
-- nigerian-states-and-lgas@1.0.8 npm package (ISC), "Kastina" corrected to
-- "Katsina". Seeded here rather than in prisma/seed.ts so every environment
-- has the reference data farms and agents point at.
INSERT INTO "State" ("id", "name") VALUES
    (gen_random_uuid()::text, 'Abia'),
    (gen_random_uuid()::text, 'Adamawa'),
    (gen_random_uuid()::text, 'Akwa Ibom'),
    (gen_random_uuid()::text, 'Anambra'),
    (gen_random_uuid()::text, 'Bauchi'),
    (gen_random_uuid()::text, 'Bayelsa'),
    (gen_random_uuid()::text, 'Benue'),
    (gen_random_uuid()::text, 'Borno'),
    (gen_random_uuid()::text, 'Cross River'),
    (gen_random_uuid()::text, 'Delta'),
    (gen_random_uuid()::text, 'Ebonyi'),
    (gen_random_uuid()::text, 'Edo'),
    (gen_random_uuid()::text, 'Ekiti'),
    (gen_random_uuid()::text, 'Enugu'),
    (gen_random_uuid()::text, 'Federal Capital Territory'),
    (gen_random_uuid()::text, 'Gombe'),
    (gen_random_uuid()::text, 'Imo'),
    (gen_random_uuid()::text, 'Jigawa'),
    (gen_random_uuid()::text, 'Kaduna'),
    (gen_random_uuid()::text, 'Kano'),
    (gen_random_uuid()::text, 'Katsina'),
    (gen_random_uuid()::text, 'Kebbi'),
    (gen_random_uuid()::text, 'Kogi'),
    (gen_random_uuid()::text, 'Kwara'),
    (gen_random_uuid()::text, 'Lagos'),
    (gen_random_uuid()::text, 'Nasarawa'),
    (gen_random_uuid()::text, 'Niger'),
    (gen_random_uuid()::text, 'Ogun'),
    (gen_random_uuid()::text, 'Ondo'),
    (gen_random_uuid()::text, 'Osun'),
    (gen_random_uuid()::text, 'Oyo'),
    (gen_random_uuid()::text, 'Plateau'),
    (gen_random_uuid()::text, 'Rivers'),
    (gen_random_uuid()::text, 'Sokoto'),
    (gen_random_uuid()::text, 'Taraba'),
    (gen_random_uuid()::text, 'Yobe'),
    (gen_random_uuid()::text, 'Zamfara');

INSERT INTO "Lga" ("id", "stateId", "name")
SELECT gen_random_uuid()::text, s."id", v."name"
FROM (VALUES
    ('Abia', 'Aba North'),
    ('Abia', 'Aba South'),
    ('Abia', 'Arochukwu'),
    ('Abia', 'Bende'),
    ('Abia', 'Ikwuano'),
    ('Abia', 'Isiala Ngwa North'),
    ('Abia', 'Isiala Ngwa South'),
    ('Abia', 'Isuikwuato'),
    ('Abia', 'Obi Ngwa'),
    ('Abia', 'Ohafia'),
    ('Abia', 'Osisioma'),
    ('Abia', 'Ugwunagbo'),
    ('Abia', 'Ukwa East'),
    ('Abia', 'Ukwa West'),
    ('Abia', 'Umuahia North'),
    ('Abia', 'Umuahia South'),
    ('Abia', 'Umu Nneochi'),
    ('Adamawa', 'Demsa'),
    ('Adamawa', 'Fufure'),
    ('Adamawa', 'Ganye'),
    ('Adamawa', 'Gayuk'),
    ('Adamawa', 'Girei'),
    ('Adamawa', 'Gombi'),
    ('Adamawa', 'Hong'),
    ('Adamawa', 'Jada'),
    ('Adamawa', 'Lamurde'),
    ('Adamawa', 'Madagali'),
    ('Adamawa', 'Maiha'),
    ('Adamawa', 'Mayo Belwa'),
    ('Adamawa', 'Michika'),
    ('Adamawa', 'Mubi North'),
    ('Adamawa', 'Mubi South'),
    ('Adamawa', 'Numan'),
    ('Adamawa', 'Shelleng'),
    ('Adamawa', 'Song'),
    ('Adamawa', 'Toungo'),
    ('Adamawa', 'Yola North'),
    ('Adamawa', 'Yola South'),
    ('Akwa Ibom', 'Abak'),
    ('Akwa Ibom', 'Eastern Obolo'),
    ('Akwa Ibom', 'Eket'),
    ('Akwa Ibom', 'Esit Eket'),
    ('Akwa Ibom', 'Essien Udim'),
    ('Akwa Ibom', 'Etim Ekpo'),
    ('Akwa Ibom', 'Etinan'),
    ('Akwa Ibom', 'Ibeno'),
    ('Akwa Ibom', 'Ibesikpo Asutan'),
    ('Akwa Ibom', 'Ibiono-Ibom'),
    ('Akwa Ibom', 'Ika'),
    ('Akwa Ibom', 'Ikono'),
    ('Akwa Ibom', 'Ikot Abasi'),
    ('Akwa Ibom', 'Ikot Ekpene'),
    ('Akwa Ibom', 'Ini'),
    ('Akwa Ibom', 'Itu'),
    ('Akwa Ibom', 'Mbo'),
    ('Akwa Ibom', 'Mkpat-Enin'),
    ('Akwa Ibom', 'Nsit-Atai'),
    ('Akwa Ibom', 'Nsit-Ibom'),
    ('Akwa Ibom', 'Nsit-Ubium'),
    ('Akwa Ibom', 'Obot Akara'),
    ('Akwa Ibom', 'Okobo'),
    ('Akwa Ibom', 'Onna'),
    ('Akwa Ibom', 'Oron'),
    ('Akwa Ibom', 'Oruk Anam'),
    ('Akwa Ibom', 'Udung-Uko'),
    ('Akwa Ibom', 'Ukanafun'),
    ('Akwa Ibom', 'Uruan'),
    ('Akwa Ibom', 'Urue-Offong/Oruko'),
    ('Akwa Ibom', 'Uyo'),
    ('Anambra', 'Aguata'),
    ('Anambra', 'Anambra East'),
    ('Anambra', 'Anambra West'),
    ('Anambra', 'Anaocha'),
    ('Anambra', 'Awka North'),
    ('Anambra', 'Awka South'),
    ('Anambra', 'Ayamelum'),
    ('Anambra', 'Dunukofia'),
    ('Anambra', 'Ekwusigo'),
    ('Anambra', 'Idemili North'),
    ('Anambra', 'Idemili South'),
    ('Anambra', 'Ihiala'),
    ('Anambra', 'Njikoka'),
    ('Anambra', 'Nnewi North'),
    ('Anambra', 'Nnewi South'),
    ('Anambra', 'Ogbaru'),
    ('Anambra', 'Onitsha North'),
    ('Anambra', 'Onitsha South'),
    ('Anambra', 'Orumba North'),
    ('Anambra', 'Orumba South'),
    ('Anambra', 'Oyi'),
    ('Bauchi', 'Alkaleri'),
    ('Bauchi', 'Bauchi'),
    ('Bauchi', 'Bogoro'),
    ('Bauchi', 'Damban'),
    ('Bauchi', 'Darazo'),
    ('Bauchi', 'Dass'),
    ('Bauchi', 'Gamawa'),
    ('Bauchi', 'Ganju/Ganjuwa'),
    ('Bauchi', 'Giade'),
    ('Bauchi', 'Itas/Gadau'),
    ('Bauchi', 'Jama''are'),
    ('Bauchi', 'Katagum'),
    ('Bauchi', 'Kirfi'),
    ('Bauchi', 'Misau'),
    ('Bauchi', 'Ningi'),
    ('Bauchi', 'Shira'),
    ('Bauchi', 'Tafawa Balewa'),
    ('Bauchi', 'Toro'),
    ('Bauchi', 'Warji'),
    ('Bauchi', 'Zaki'),
    ('Bayelsa', 'Brass'),
    ('Bayelsa', 'Ekere/Ekeremor'),
    ('Bayelsa', 'Kolokuma/Opokuma'),
    ('Bayelsa', 'Nembe'),
    ('Bayelsa', 'Ogbia'),
    ('Bayelsa', 'Sagba/Sagbama'),
    ('Bayelsa', 'Southern Ijaw'),
    ('Bayelsa', 'Yenagoa'),
    ('Benue', 'Ado'),
    ('Benue', 'Agatu'),
    ('Benue', 'Apa'),
    ('Benue', 'Buruku'),
    ('Benue', 'Gboko'),
    ('Benue', 'Guma'),
    ('Benue', 'Gwer East'),
    ('Benue', 'Gwer West'),
    ('Benue', 'Katsina-Ala'),
    ('Benue', 'Konshisha'),
    ('Benue', 'Kwande'),
    ('Benue', 'Logo'),
    ('Benue', 'Makurdi'),
    ('Benue', 'Obi'),
    ('Benue', 'Ogbadibo'),
    ('Benue', 'Ohimini'),
    ('Benue', 'Oju'),
    ('Benue', 'Okpokwu'),
    ('Benue', 'Oturkpo'),
    ('Benue', 'Tarka'),
    ('Benue', 'Ukum'),
    ('Benue', 'Ushongo'),
    ('Benue', 'Vandeikya'),
    ('Borno', 'Abadam'),
    ('Borno', 'Askira/Uba'),
    ('Borno', 'Bama'),
    ('Borno', 'Bayo'),
    ('Borno', 'Biu'),
    ('Borno', 'Chibok'),
    ('Borno', 'Damboa'),
    ('Borno', 'Dikwa'),
    ('Borno', 'Gubio'),
    ('Borno', 'Guzamala'),
    ('Borno', 'Gwoza'),
    ('Borno', 'Hawul'),
    ('Borno', 'Jere'),
    ('Borno', 'Kaga'),
    ('Borno', 'Kala/Balge'),
    ('Borno', 'Konduga'),
    ('Borno', 'Kukawa'),
    ('Borno', 'Kwaya Kusar'),
    ('Borno', 'Mafa'),
    ('Borno', 'Magumeri'),
    ('Borno', 'Maiduguri'),
    ('Borno', 'Marte'),
    ('Borno', 'Mobbar'),
    ('Borno', 'Monguno'),
    ('Borno', 'Ngala'),
    ('Borno', 'Nganzai'),
    ('Borno', 'Shani'),
    ('Cross River', 'Abi'),
    ('Cross River', 'Akamkpa'),
    ('Cross River', 'Akpabuyo'),
    ('Cross River', 'Bakassi'),
    ('Cross River', 'Bekwarra'),
    ('Cross River', 'Biase'),
    ('Cross River', 'Boki'),
    ('Cross River', 'Calabar Municipal'),
    ('Cross River', 'Calabar South'),
    ('Cross River', 'Etung'),
    ('Cross River', 'Ikom'),
    ('Cross River', 'Obanliku'),
    ('Cross River', 'Obubra'),
    ('Cross River', 'Obudu'),
    ('Cross River', 'Odukpani'),
    ('Cross River', 'Ogoja'),
    ('Cross River', 'Yakuur'),
    ('Cross River', 'Yala'),
    ('Delta', 'Aniocha North'),
    ('Delta', 'Aniocha South'),
    ('Delta', 'Bomadi'),
    ('Delta', 'Burutu'),
    ('Delta', 'Ethiope East'),
    ('Delta', 'Ethiope West'),
    ('Delta', 'Ika North East'),
    ('Delta', 'Ika South'),
    ('Delta', 'Isoko North'),
    ('Delta', 'Isoko South'),
    ('Delta', 'Ndokwa East'),
    ('Delta', 'Ndokwa West'),
    ('Delta', 'Okpe'),
    ('Delta', 'Oshimili North'),
    ('Delta', 'Oshimili South'),
    ('Delta', 'Patani'),
    ('Delta', 'Sapele'),
    ('Delta', 'Udu'),
    ('Delta', 'Ughelli North'),
    ('Delta', 'Ughelli South'),
    ('Delta', 'Ukwuani'),
    ('Delta', 'Uvwie'),
    ('Delta', 'Warri North'),
    ('Delta', 'Warri South'),
    ('Delta', 'Warri South West'),
    ('Ebonyi', 'Abakaliki'),
    ('Ebonyi', 'Afikpo North'),
    ('Ebonyi', 'Afikpo South'),
    ('Ebonyi', 'Ebonyi'),
    ('Ebonyi', 'Ezza North'),
    ('Ebonyi', 'Ezza South'),
    ('Ebonyi', 'Ikwo'),
    ('Ebonyi', 'Ishielu'),
    ('Ebonyi', 'Ivo'),
    ('Ebonyi', 'Izzi'),
    ('Ebonyi', 'Ohaozara'),
    ('Ebonyi', 'Ohaukwu'),
    ('Ebonyi', 'Onicha'),
    ('Edo', 'Akoko-Edo'),
    ('Edo', 'Egor'),
    ('Edo', 'Esan Central'),
    ('Edo', 'Esan North-East'),
    ('Edo', 'Esan South-East'),
    ('Edo', 'Esan West'),
    ('Edo', 'Etsako Central'),
    ('Edo', 'Etsako East'),
    ('Edo', 'Etsako West'),
    ('Edo', 'Igueben'),
    ('Edo', 'Ikpoba Okha'),
    ('Edo', 'Orhionmwon'),
    ('Edo', 'Oredo'),
    ('Edo', 'Ovia North-East'),
    ('Edo', 'Ovia South-West'),
    ('Edo', 'Owan East'),
    ('Edo', 'Owan West'),
    ('Edo', 'Uhunmwonde'),
    ('Ekiti', 'Ado Ekiti'),
    ('Ekiti', 'Efon'),
    ('Ekiti', 'Ekiti East'),
    ('Ekiti', 'Ekiti South-West'),
    ('Ekiti', 'Ekiti West'),
    ('Ekiti', 'Emure'),
    ('Ekiti', 'Gbonyin'),
    ('Ekiti', 'Ido Osi'),
    ('Ekiti', 'Ijero'),
    ('Ekiti', 'Ikere'),
    ('Ekiti', 'Ikole'),
    ('Ekiti', 'Ilejemeje'),
    ('Ekiti', 'Irepodun/Ifelodun'),
    ('Ekiti', 'Ise/Orun'),
    ('Ekiti', 'Moba'),
    ('Ekiti', 'Oye'),
    ('Enugu', 'Aninri'),
    ('Enugu', 'Awgu'),
    ('Enugu', 'Enugu East'),
    ('Enugu', 'Enugu North'),
    ('Enugu', 'Enugu South'),
    ('Enugu', 'Ezeagu'),
    ('Enugu', 'Igbo Etiti'),
    ('Enugu', 'Igbo Eze North'),
    ('Enugu', 'Igbo Eze South'),
    ('Enugu', 'Isi Uzo'),
    ('Enugu', 'Nkanu East'),
    ('Enugu', 'Nkanu West'),
    ('Enugu', 'Nsukka'),
    ('Enugu', 'Oji River'),
    ('Enugu', 'Udenu'),
    ('Enugu', 'Udi'),
    ('Enugu', 'Uzo-Uwani'),
    ('Gombe', 'Akko'),
    ('Gombe', 'Balanga'),
    ('Gombe', 'Billiri'),
    ('Gombe', 'Dukku'),
    ('Gombe', 'Funakaye'),
    ('Gombe', 'Gombe'),
    ('Gombe', 'Kaltungo'),
    ('Gombe', 'Kwami'),
    ('Gombe', 'Nafada'),
    ('Gombe', 'Shongom'),
    ('Gombe', 'Yamaltu/Deba'),
    ('Imo', 'Aboh Mbaise'),
    ('Imo', 'Ahiazu Mbaise'),
    ('Imo', 'Ehime Mbano'),
    ('Imo', 'Ezinihitte'),
    ('Imo', 'Ideato North'),
    ('Imo', 'Ideato South'),
    ('Imo', 'Ihitte/Uboma'),
    ('Imo', 'Ikeduru'),
    ('Imo', 'Isiala Mbano'),
    ('Imo', 'Isu'),
    ('Imo', 'Mbaitoli'),
    ('Imo', 'Ngor Okpala'),
    ('Imo', 'Njaba'),
    ('Imo', 'Nkwerre'),
    ('Imo', 'Nwangele'),
    ('Imo', 'Obowo'),
    ('Imo', 'Oguta'),
    ('Imo', 'Ohaji/Egbema'),
    ('Imo', 'Okigwe'),
    ('Imo', 'Orlu'),
    ('Imo', 'Orsu'),
    ('Imo', 'Oru East'),
    ('Imo', 'Oru West'),
    ('Imo', 'Owerri Municipal'),
    ('Imo', 'Owerri North'),
    ('Imo', 'Owerri West'),
    ('Imo', 'Unuimo'),
    ('Jigawa', 'Auyo'),
    ('Jigawa', 'Babura'),
    ('Jigawa', 'Biriniwa'),
    ('Jigawa', 'Birnin Kudu'),
    ('Jigawa', 'Buji'),
    ('Jigawa', 'Dutse'),
    ('Jigawa', 'Gagarawa'),
    ('Jigawa', 'Garki'),
    ('Jigawa', 'Gumel'),
    ('Jigawa', 'Guri'),
    ('Jigawa', 'Gwaram'),
    ('Jigawa', 'Gwiwa'),
    ('Jigawa', 'Hadejia'),
    ('Jigawa', 'Jahun'),
    ('Jigawa', 'Kafin Hausa'),
    ('Jigawa', 'Kaugama'),
    ('Jigawa', 'Kazaure'),
    ('Jigawa', 'Kiri Kasama'),
    ('Jigawa', 'Kiyawa'),
    ('Jigawa', 'Maigatari'),
    ('Jigawa', 'Malam Madori'),
    ('Jigawa', 'Miga'),
    ('Jigawa', 'Ringim'),
    ('Jigawa', 'Roni'),
    ('Jigawa', 'Sule Tankarkar'),
    ('Jigawa', 'Taura'),
    ('Jigawa', 'Yankwashi'),
    ('Kaduna', 'Birnin Gwari'),
    ('Kaduna', 'Chikun'),
    ('Kaduna', 'Giwa'),
    ('Kaduna', 'Igabi'),
    ('Kaduna', 'Ikara'),
    ('Kaduna', 'Jaba'),
    ('Kaduna', 'Jema''a'),
    ('Kaduna', 'Kachia'),
    ('Kaduna', 'Kaduna North'),
    ('Kaduna', 'Kaduna South'),
    ('Kaduna', 'Kagarko'),
    ('Kaduna', 'Kajuru'),
    ('Kaduna', 'Kaura'),
    ('Kaduna', 'Kauru'),
    ('Kaduna', 'Kubau'),
    ('Kaduna', 'Kudan'),
    ('Kaduna', 'Lere'),
    ('Kaduna', 'Makarfi'),
    ('Kaduna', 'Sabon Gari'),
    ('Kaduna', 'Sanga'),
    ('Kaduna', 'Soba'),
    ('Kaduna', 'Zangon Kataf'),
    ('Kaduna', 'Zaria'),
    ('Kano', 'Ajingi'),
    ('Kano', 'Albasu'),
    ('Kano', 'Bagwai'),
    ('Kano', 'Bebeji'),
    ('Kano', 'Bichi'),
    ('Kano', 'Bunkure'),
    ('Kano', 'Dala'),
    ('Kano', 'Dambatta'),
    ('Kano', 'Dawakin Kudu'),
    ('Kano', 'Dawakin Tofa'),
    ('Kano', 'Doguwa'),
    ('Kano', 'Fagge'),
    ('Kano', 'Gabasawa'),
    ('Kano', 'Garko'),
    ('Kano', 'Garun Mallam'),
    ('Kano', 'Gaya'),
    ('Kano', 'Gezawa'),
    ('Kano', 'Gwale'),
    ('Kano', 'Gwarzo'),
    ('Kano', 'Kabo'),
    ('Kano', 'Kano Municipal'),
    ('Kano', 'Karaye'),
    ('Kano', 'Kibiya'),
    ('Kano', 'Kiru'),
    ('Kano', 'Kumbotso'),
    ('Kano', 'Kunchi'),
    ('Kano', 'Kura'),
    ('Kano', 'Madobi'),
    ('Kano', 'Makoda'),
    ('Kano', 'Minjibir'),
    ('Kano', 'Nasarawa'),
    ('Kano', 'Rano'),
    ('Kano', 'Rimin Gado'),
    ('Kano', 'Rogo'),
    ('Kano', 'Shanono'),
    ('Kano', 'Sumaila'),
    ('Kano', 'Takai'),
    ('Kano', 'Tarauni'),
    ('Kano', 'Tofa'),
    ('Kano', 'Tsanyawa'),
    ('Kano', 'Tudun Wada'),
    ('Kano', 'Ungogo'),
    ('Kano', 'Warawa'),
    ('Kano', 'Wudil'),
    ('Katsina', 'Bakori'),
    ('Katsina', 'Batagarawa'),
    ('Katsina', 'Batsari'),
    ('Katsina', 'Baure'),
    ('Katsina', 'Bindawa'),
    ('Katsina', 'Charanchi'),
    ('Katsina', 'Dandume'),
    ('Katsina', 'Danja'),
    ('Katsina', 'Dan Musa'),
    ('Katsina', 'Daura'),
    ('Katsina', 'Dutsi'),
    ('Katsina', 'Dutsin Ma'),
    ('Katsina', 'Faskari'),
    ('Katsina', 'Funtua'),
    ('Katsina', 'Ingawa'),
    ('Katsina', 'Jibia'),
    ('Katsina', 'Kafur'),
    ('Katsina', 'Kaita'),
    ('Katsina', 'Kankara'),
    ('Katsina', 'Kankia'),
    ('Katsina', 'Katsina'),
    ('Katsina', 'Kurfi'),
    ('Katsina', 'Kusada'),
    ('Katsina', 'Mai''Adua'),
    ('Katsina', 'Malumfashi'),
    ('Katsina', 'Mani'),
    ('Katsina', 'Mashi'),
    ('Katsina', 'Matazu'),
    ('Katsina', 'Musawa'),
    ('Katsina', 'Rimi'),
    ('Katsina', 'Sabuwa'),
    ('Katsina', 'Safana'),
    ('Katsina', 'Sanda/Sandamu'),
    ('Katsina', 'Zango'),
    ('Kebbi', 'Aleiro'),
    ('Kebbi', 'Arewa'),
    ('Kebbi', 'Argungu'),
    ('Kebbi', 'Augie'),
    ('Kebbi', 'Bagudo'),
    ('Kebbi', 'Birnin Kebbi'),
    ('Kebbi', 'Bunza'),
    ('Kebbi', 'Dandi'),
    ('Kebbi', 'Fakai'),
    ('Kebbi', 'Gwandu'),
    ('Kebbi', 'Jega'),
    ('Kebbi', 'Kalgo'),
    ('Kebbi', 'Koko/Besse'),
    ('Kebbi', 'Maiya/Maiyama'),
    ('Kebbi', 'Ngaski'),
    ('Kebbi', 'Sakaba'),
    ('Kebbi', 'Shanga'),
    ('Kebbi', 'Suru'),
    ('Kebbi', 'Danko-Wasagu'),
    ('Kebbi', 'Yauri'),
    ('Kebbi', 'Zuru'),
    ('Kogi', 'Adavi'),
    ('Kogi', 'Ajaokuta'),
    ('Kogi', 'Ankpa'),
    ('Kogi', 'Bassa'),
    ('Kogi', 'Dekina'),
    ('Kogi', 'Ibaji'),
    ('Kogi', 'Idah'),
    ('Kogi', 'Igalamela Odolu'),
    ('Kogi', 'Ijumu'),
    ('Kogi', 'Kabba/Bunu'),
    ('Kogi', 'Kogi'),
    ('Kogi', 'Lokoja'),
    ('Kogi', 'Mopa Muro'),
    ('Kogi', 'Ofu'),
    ('Kogi', 'Ogori/Magongo'),
    ('Kogi', 'Okehi'),
    ('Kogi', 'Okene'),
    ('Kogi', 'Olamaboro'),
    ('Kogi', 'Omala'),
    ('Kogi', 'Yagba East'),
    ('Kogi', 'Yagba West'),
    ('Kwara', 'Asa'),
    ('Kwara', 'Baruten'),
    ('Kwara', 'Edu'),
    ('Kwara', 'Ekiti'),
    ('Kwara', 'Ifelodun'),
    ('Kwara', 'Ilorin East'),
    ('Kwara', 'Ilorin South'),
    ('Kwara', 'Ilorin West'),
    ('Kwara', 'Irepodun'),
    ('Kwara', 'Isin'),
    ('Kwara', 'Kaiama'),
    ('Kwara', 'Moro'),
    ('Kwara', 'Offa'),
    ('Kwara', 'Oke Ero'),
    ('Kwara', 'Oyun'),
    ('Kwara', 'Pategi'),
    ('Lagos', 'Agege'),
    ('Lagos', 'Ajeromi-Ifelodun'),
    ('Lagos', 'Alimosho'),
    ('Lagos', 'Amuwo-Odofin'),
    ('Lagos', 'Apapa'),
    ('Lagos', 'Badagry'),
    ('Lagos', 'Epe'),
    ('Lagos', 'Eti Osa'),
    ('Lagos', 'Ibeju-Lekki'),
    ('Lagos', 'Ifako-Ijaiye'),
    ('Lagos', 'Ikeja'),
    ('Lagos', 'Ikorodu'),
    ('Lagos', 'Kosofe'),
    ('Lagos', 'Lagos Island'),
    ('Lagos', 'Lagos Mainland'),
    ('Lagos', 'Mushin'),
    ('Lagos', 'Ojo'),
    ('Lagos', 'Oshodi-Isolo'),
    ('Lagos', 'Shomolu'),
    ('Lagos', 'Surulere'),
    ('Nasarawa', 'Akwanga'),
    ('Nasarawa', 'Awe'),
    ('Nasarawa', 'Doma'),
    ('Nasarawa', 'Karu'),
    ('Nasarawa', 'Keana'),
    ('Nasarawa', 'Keffi'),
    ('Nasarawa', 'Kokona'),
    ('Nasarawa', 'Lafia'),
    ('Nasarawa', 'Nasarawa'),
    ('Nasarawa', 'Nasarawa Egon'),
    ('Nasarawa', 'Obi'),
    ('Nasarawa', 'Toto'),
    ('Nasarawa', 'Wamba'),
    ('Niger', 'Agaie'),
    ('Niger', 'Agwara'),
    ('Niger', 'Bida'),
    ('Niger', 'Borgu'),
    ('Niger', 'Bosso'),
    ('Niger', 'Chanchaga'),
    ('Niger', 'Edati'),
    ('Niger', 'Gbako'),
    ('Niger', 'Gurara'),
    ('Niger', 'Katcha'),
    ('Niger', 'Kontagora'),
    ('Niger', 'Lapai'),
    ('Niger', 'Lavun'),
    ('Niger', 'Magama'),
    ('Niger', 'Mariga'),
    ('Niger', 'Mashegu'),
    ('Niger', 'Mokwa'),
    ('Niger', 'Moya'),
    ('Niger', 'Paikoro'),
    ('Niger', 'Rafi'),
    ('Niger', 'Rijau'),
    ('Niger', 'Shiroro'),
    ('Niger', 'Suleja'),
    ('Niger', 'Tafa'),
    ('Niger', 'Wushishi'),
    ('Ogun', 'Abeokuta North'),
    ('Ogun', 'Abeokuta South'),
    ('Ogun', 'Ado-Odo/Ota'),
    ('Ogun', 'Ewekoro'),
    ('Ogun', 'Ifo'),
    ('Ogun', 'Ijebu East'),
    ('Ogun', 'Ijebu North'),
    ('Ogun', 'Ijebu North East'),
    ('Ogun', 'Ijebu Ode'),
    ('Ogun', 'Ikenne'),
    ('Ogun', 'Imeko Afon'),
    ('Ogun', 'Ipokia'),
    ('Ogun', 'Obafemi/Obafemi Owode'),
    ('Ogun', 'Odeda'),
    ('Ogun', 'Odogbolu'),
    ('Ogun', 'Ogun Waterside'),
    ('Ogun', 'Remo North'),
    ('Ogun', 'Shaga/Shagamu'),
    ('Ogun', 'Yewa North'),
    ('Ogun', 'Yewa South'),
    ('Ondo', 'Akoko North-East'),
    ('Ondo', 'Akoko North-West'),
    ('Ondo', 'Akoko South-East'),
    ('Ondo', 'Akoko South-West'),
    ('Ondo', 'Akure North'),
    ('Ondo', 'Akure South'),
    ('Ondo', 'Ese Odo'),
    ('Ondo', 'Idanre'),
    ('Ondo', 'Ifedore'),
    ('Ondo', 'Ilaje'),
    ('Ondo', 'Ile Oluji/Okeigbo'),
    ('Ondo', 'Irele'),
    ('Ondo', 'Odigbo'),
    ('Ondo', 'Okitipupa'),
    ('Ondo', 'Ondo East'),
    ('Ondo', 'Ondo West'),
    ('Ondo', 'Ose'),
    ('Ondo', 'Owo'),
    ('Osun', 'Aiyedaade'),
    ('Osun', 'Aiyedire'),
    ('Osun', 'Atakunmosa East'),
    ('Osun', 'Atakunmosa West'),
    ('Osun', 'Boluwaduro'),
    ('Osun', 'Boripe'),
    ('Osun', 'Ede North'),
    ('Osun', 'Ede South'),
    ('Osun', 'Egbedore'),
    ('Osun', 'Ejigbo'),
    ('Osun', 'Ife Central'),
    ('Osun', 'Ife East'),
    ('Osun', 'Ife North'),
    ('Osun', 'Ife South'),
    ('Osun', 'Ifedayo'),
    ('Osun', 'Ifelodun'),
    ('Osun', 'Ila'),
    ('Osun', 'Ilesa East'),
    ('Osun', 'Ilesa West'),
    ('Osun', 'Irepodun'),
    ('Osun', 'Irewole'),
    ('Osun', 'Isokan'),
    ('Osun', 'Iwo'),
    ('Osun', 'Obokun'),
    ('Osun', 'Odo Otin'),
    ('Osun', 'Ola Oluwa'),
    ('Osun', 'Olorunda'),
    ('Osun', 'Oriade'),
    ('Osun', 'Orolu'),
    ('Osun', 'Osogbo'),
    ('Oyo', 'Afijio'),
    ('Oyo', 'Akinyele'),
    ('Oyo', 'Atiba'),
    ('Oyo', 'Atisbo'),
    ('Oyo', 'Egbeda'),
    ('Oyo', 'Ibadan North'),
    ('Oyo', 'Ibadan North-East'),
    ('Oyo', 'Ibadan North-West'),
    ('Oyo', 'Ibadan South-East'),
    ('Oyo', 'Ibadan South-West'),
    ('Oyo', 'Ibarapa Central'),
    ('Oyo', 'Ibarapa East'),
    ('Oyo', 'Ibarapa North'),
    ('Oyo', 'Ido'),
    ('Oyo', 'Irepo'),
    ('Oyo', 'Iseyin'),
    ('Oyo', 'Itesiwaju'),
    ('Oyo', 'Iwajowa'),
    ('Oyo', 'Kajola'),
    ('Oyo', 'Lagelu'),
    ('Oyo', 'Ogbomosho North'),
    ('Oyo', 'Ogbomosho South'),
    ('Oyo', 'Ogo Oluwa'),
    ('Oyo', 'Olorunsogo'),
    ('Oyo', 'Oluyole'),
    ('Oyo', 'Ona Ara'),
    ('Oyo', 'Orelope'),
    ('Oyo', 'Ori Ire'),
    ('Oyo', 'Oyo East'),
    ('Oyo', 'Oyo West'),
    ('Oyo', 'Saki East'),
    ('Oyo', 'Saki West'),
    ('Oyo', 'Surulere'),
    ('Plateau', 'Bokkos'),
    ('Plateau', 'Barkin Ladi'),
    ('Plateau', 'Bassa'),
    ('Plateau', 'Jos East'),
    ('Plateau', 'Jos North'),
    ('Plateau', 'Jos South'),
    ('Plateau', 'Kanam'),
    ('Plateau', 'Kanke'),
    ('Plateau', 'Langtang North'),
    ('Plateau', 'Langtang South'),
    ('Plateau', 'Mangu'),
    ('Plateau', 'Mikang'),
    ('Plateau', 'Pankshin'),
    ('Plateau', 'Qua''an Pan'),
    ('Plateau', 'Riyom'),
    ('Plateau', 'Shendam'),
    ('Plateau', 'Wase'),
    ('Rivers', 'Abua/Odual'),
    ('Rivers', 'Ahoada East'),
    ('Rivers', 'Ahoada West'),
    ('Rivers', 'Akuku-Toru'),
    ('Rivers', 'Andoni'),
    ('Rivers', 'Asari-Toru'),
    ('Rivers', 'Bonny'),
    ('Rivers', 'Degema'),
    ('Rivers', 'Eleme'),
    ('Rivers', 'Emuoha'),
    ('Rivers', 'Etche'),
    ('Rivers', 'Gokana'),
    ('Rivers', 'Ikwerre'),
    ('Rivers', 'Khana'),
    ('Rivers', 'Obio/Akpor'),
    ('Rivers', 'Ogba/Egbema/Ndoni'),
    ('Rivers', 'Ogu/Bolo'),
    ('Rivers', 'Okrika'),
    ('Rivers', 'Omuma'),
    ('Rivers', 'Opobo/Nkoro'),
    ('Rivers', 'Oyigbo'),
    ('Rivers', 'Port Harcourt'),
    ('Rivers', 'Tai'),
    ('Sokoto', 'Binji'),
    ('Sokoto', 'Bodinga'),
    ('Sokoto', 'Dange Shuni'),
    ('Sokoto', 'Gada'),
    ('Sokoto', 'Goron/Goronyo'),
    ('Sokoto', 'Gudu'),
    ('Sokoto', 'Gwadabawa'),
    ('Sokoto', 'Illela'),
    ('Sokoto', 'Isa'),
    ('Sokoto', 'Kebbe'),
    ('Sokoto', 'Kware'),
    ('Sokoto', 'Rabah'),
    ('Sokoto', 'Sabon Birni'),
    ('Sokoto', 'Shagari'),
    ('Sokoto', 'Silame'),
    ('Sokoto', 'Sokoto North'),
    ('Sokoto', 'Sokoto South'),
    ('Sokoto', 'Tambuwal'),
    ('Sokoto', 'Tangaza'),
    ('Sokoto', 'Tureta'),
    ('Sokoto', 'Wamako'),
    ('Sokoto', 'Wurno'),
    ('Sokoto', 'Yabo'),
    ('Taraba', 'Ardo Kola'),
    ('Taraba', 'Bali'),
    ('Taraba', 'Donga'),
    ('Taraba', 'Gashaka'),
    ('Taraba', 'Gassol'),
    ('Taraba', 'Ibi'),
    ('Taraba', 'Jalingo'),
    ('Taraba', 'Karim Lamido'),
    ('Taraba', 'Kumi'),
    ('Taraba', 'Lau'),
    ('Taraba', 'Sardauna'),
    ('Taraba', 'Takum'),
    ('Taraba', 'Ussa'),
    ('Taraba', 'Wukari'),
    ('Taraba', 'Yorro'),
    ('Taraba', 'Zing'),
    ('Yobe', 'Bade'),
    ('Yobe', 'Bursari'),
    ('Yobe', 'Damaturu'),
    ('Yobe', 'Fika'),
    ('Yobe', 'Fune'),
    ('Yobe', 'Geidam'),
    ('Yobe', 'Gujba'),
    ('Yobe', 'Gulani'),
    ('Yobe', 'Jakusko'),
    ('Yobe', 'Karasuwa'),
    ('Yobe', 'Machina'),
    ('Yobe', 'Nangere'),
    ('Yobe', 'Nguru'),
    ('Yobe', 'Potiskum'),
    ('Yobe', 'Tarmuwa'),
    ('Yobe', 'Yunusari'),
    ('Yobe', 'Yusufari'),
    ('Zamfara', 'Anka'),
    ('Zamfara', 'Bakura'),
    ('Zamfara', 'Birnin Magaji/Kiyaw'),
    ('Zamfara', 'Bukkuyum'),
    ('Zamfara', 'Bungudu'),
    ('Zamfara', 'Chafe'),
    ('Zamfara', 'Gummi'),
    ('Zamfara', 'Gusau'),
    ('Zamfara', 'Kaura Namoda'),
    ('Zamfara', 'Maradun'),
    ('Zamfara', 'Maru'),
    ('Zamfara', 'Shinkafi'),
    ('Zamfara', 'Talata Mafara'),
    ('Zamfara', 'Zurmi'),
    ('Federal Capital Territory', 'Abaji'),
    ('Federal Capital Territory', 'Abuja Municipal Area Council'),
    ('Federal Capital Territory', 'Bwari'),
    ('Federal Capital Territory', 'Gwagwalada'),
    ('Federal Capital Territory', 'Kuje'),
    ('Federal Capital Territory', 'Kwali')
) AS v("state", "name")
JOIN "State" s ON s."name" = v."state";
