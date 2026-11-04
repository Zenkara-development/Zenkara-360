-- Custom fields gain two capabilities: a default value prefilled into new
-- records, and conditional visibility driven by another field on the same
-- entity ("show Escalation reason only when Priority is High or Critical").
--
-- All three columns are nullable with no default, so every existing field row
-- keeps its current behaviour: no default to prefill, no condition to satisfy,
-- therefore always visible. Nothing is backfilled and no existing custom field
-- value is touched.

-- Prefilled into a CREATE form only. Stored as text like custom_field_values.value;
-- the field's own field_type decides how it is parsed.
ALTER TABLE "custom_fields" ADD COLUMN "default_value" TEXT;

-- The parent field whose value controls this one, plus the list of parent
-- values that reveal it (a JSON array of strings, e.g. ["HIGH","CRITICAL"]).
-- Both are set together or both stay null — the application enforces that
-- pairing, since a partial rule is meaningless.
ALTER TABLE "custom_fields" ADD COLUMN "depends_on_field_id" TEXT;
ALTER TABLE "custom_fields" ADD COLUMN "depends_on_values" JSONB;

-- Look-ups go parent -> dependents when rendering a form, so index the child side.
CREATE INDEX "custom_fields_depends_on_field_id_idx" ON "custom_fields"("depends_on_field_id");

-- ON DELETE SET NULL, deliberately not CASCADE: removing the parent field must
-- not delete the dependent field along with every value already captured
-- against it. Losing a rule is recoverable by re-creating it; losing a column
-- of customer data is not. A dependent whose parent disappears simply becomes
-- unconditional (always visible), which is the safe direction to fail in.
ALTER TABLE "custom_fields"
  ADD CONSTRAINT "custom_fields_depends_on_field_id_fkey"
  FOREIGN KEY ("depends_on_field_id") REFERENCES "custom_fields"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
