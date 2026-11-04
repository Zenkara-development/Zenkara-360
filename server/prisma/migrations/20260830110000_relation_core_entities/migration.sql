-- RELATION fields may now target a core entity (CONTACT/ACCOUNT/DEAL/TICKET)
-- instead of another custom module.
ALTER TABLE "custom_module_fields" ADD COLUMN "relation_entity" TEXT;
