-- The original check only allowed a farmer or an extension agent. Admin,
-- buyer, and system rows on a sourcing request have no farmer id.
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_actor_check";

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actor_check" CHECK (
  ("actorType" = 'FARMER' AND "farmerId" IS NOT NULL AND "agentId" IS NULL)
  OR ("actorType" = 'EXTENSION_AGENT' AND "agentId" IS NOT NULL AND "farmerId" IS NULL)
  OR ("actorType" = 'ADMIN' AND "farmerId" IS NULL)
  OR ("actorType" = 'BUYER' AND "farmerId" IS NULL AND "agentId" IS NULL)
  OR ("actorType" = 'SYSTEM' AND "farmerId" IS NULL AND "agentId" IS NULL)
);
