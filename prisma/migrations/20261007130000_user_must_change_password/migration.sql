-- Agent-onboarded farmers start on a temporary password and must change it.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
