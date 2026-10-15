-- Evidence status, and one column per document a verification round collects.
-- Identity and ownership stay on Farmer and Farm. Issue photos stay in
-- VerificationEvidence. Entrance, farm-area, produce and location-discrepancy
-- files move onto the round so they are no longer a free-form pile.

CREATE TYPE "EvidenceStatus" AS ENUM ('INCOMPLETE', 'AWAITING_DOCS', 'FOLLOW_UP', 'MISSING_DOCS');

ALTER TABLE "FarmVerification"
  ADD COLUMN "evidenceStatus" "EvidenceStatus" NOT NULL DEFAULT 'MISSING_DOCS',
  ADD COLUMN "locationEvidenceKey" TEXT,
  ADD COLUMN "productionEvidenceKey" TEXT,
  ADD COLUMN "farmPlotSketchKey" TEXT,
  ADD COLUMN "harvestEstimateKey" TEXT;

UPDATE "FarmVerification" AS round
SET "locationEvidenceKey" = photo."storageKey"
FROM (
  SELECT DISTINCT ON ("verificationId") "verificationId", "storageKey"
  FROM "VerificationEvidence"
  WHERE "kind" = 'PHOTO' AND "photoSlot" = 'ENTRANCE'
  ORDER BY "verificationId", "createdAt" DESC
) AS photo
WHERE round."id" = photo."verificationId";

UPDATE "FarmVerification" AS round
SET "farmPlotSketchKey" = photo."storageKey"
FROM (
  SELECT DISTINCT ON ("verificationId") "verificationId", "storageKey"
  FROM "VerificationEvidence"
  WHERE "kind" = 'PHOTO' AND "photoSlot" = 'FARM_AREA'
  ORDER BY "verificationId", "createdAt" DESC
) AS photo
WHERE round."id" = photo."verificationId";

UPDATE "FarmVerification" AS round
SET "productionEvidenceKey" = photo."storageKey"
FROM (
  SELECT DISTINCT ON ("verificationId") "verificationId", "storageKey"
  FROM "VerificationEvidence"
  WHERE "kind" = 'PHOTO' AND "photoSlot" = 'PRODUCE'
  ORDER BY "verificationId", "createdAt" DESC
) AS photo
WHERE round."id" = photo."verificationId";

UPDATE "FarmVerification" AS round
SET "locationEvidenceKey" = photo."storageKey"
FROM (
  SELECT DISTINCT ON ("verificationId") "verificationId", "storageKey"
  FROM "VerificationEvidence"
  WHERE "kind" = 'LOCATION_DISCREPANCY'
  ORDER BY "verificationId", "createdAt" DESC
) AS photo
WHERE round."id" = photo."verificationId"
  AND round."locationEvidenceKey" IS NULL;

DELETE FROM "VerificationEvidence"
WHERE ("kind" = 'PHOTO' AND "photoSlot" IN ('ENTRANCE', 'FARM_AREA', 'PRODUCE'))
   OR "kind" = 'LOCATION_DISCREPANCY';

-- Decided rounds are not recalculated later. They count as incomplete once the
-- documents that approval used to require are present. Harvest estimate is
-- new, so it is not demanded of a round that already closed.
UPDATE "FarmVerification" AS round
SET "evidenceStatus" = 'INCOMPLETE'
FROM "Farm" AS farm
JOIN "Farmer" AS farmer ON farmer."id" = farm."ownerId"
WHERE round."farmId" = farm."id"
  AND round."status" IN ('APPROVED', 'REJECTED')
  AND farmer."idDocumentKey" IS NOT NULL
  AND farm."ownershipDocumentKey" IS NOT NULL
  AND round."locationEvidenceKey" IS NOT NULL
  AND round."productionEvidenceKey" IS NOT NULL
  AND round."farmPlotSketchKey" IS NOT NULL;

-- Open rounds need the harvest estimate as well.
UPDATE "FarmVerification" AS round
SET "evidenceStatus" = 'INCOMPLETE'
FROM "Farm" AS farm
JOIN "Farmer" AS farmer ON farmer."id" = farm."ownerId"
WHERE round."farmId" = farm."id"
  AND round."status" IN ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS')
  AND farmer."idDocumentKey" IS NOT NULL
  AND farm."ownershipDocumentKey" IS NOT NULL
  AND round."locationEvidenceKey" IS NOT NULL
  AND round."productionEvidenceKey" IS NOT NULL
  AND round."farmPlotSketchKey" IS NOT NULL
  AND round."harvestEstimateKey" IS NOT NULL;
