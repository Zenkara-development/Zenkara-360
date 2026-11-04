-- Canonicalise every address used to sign in: trimmed and lower-cased.
--
-- Password login compared the address exactly, while the Google and Entra
-- paths lower-cased theirs before looking it up. The two therefore disagreed:
-- an account registered as "Kesava@example.com" could not be found by SSO,
-- which then provisioned a second account for the same person. Application
-- code now normalises at the validation boundary; this brings existing rows
-- into line so the two agree about accounts created before that.
--
-- Deliberately scoped to identity tables. contacts.email, employee_contacts.email
-- and email_accounts.email are left exactly as entered: those are a customer's
-- own contact details, not a credential, and are displayed back to the user.

-- ── Safety gate ──────────────────────────────────────────────────────────────
-- If two users already differ only by capitalisation, lower-casing would
-- collide with users.email's unique index and the migration would abort
-- half-way with a constraint error that says nothing useful. Fail first, with
-- an explanation and the offending address, so an operator can decide which
-- account is real — merging or deleting an account is not a decision a
-- migration should make on its own.
DO $$
DECLARE
  clash TEXT;
BEGIN
  SELECT lower(email) INTO clash
  FROM users
  GROUP BY lower(email)
  HAVING count(*) > 1
  LIMIT 1;

  IF clash IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalise login emails: more than one user account exists for "%" differing only by capitalisation. Merge or deactivate the duplicates, then re-run this migration.', clash;
  END IF;
END $$;

-- Same check for the customer portal, which is unique per (org_id, email).
DO $$
DECLARE
  clash TEXT;
BEGIN
  SELECT lower(email) INTO clash
  FROM portal_users
  GROUP BY org_id, lower(email)
  HAVING count(*) > 1
  LIMIT 1;

  IF clash IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalise portal emails: an organisation has more than one portal user for "%" differing only by capitalisation. Remove the duplicate, then re-run this migration.', clash;
  END IF;
END $$;

-- ── Normalise ────────────────────────────────────────────────────────────────
UPDATE "users"                SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));
UPDATE "portal_users"         SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));
UPDATE "invite_tokens"        SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));
UPDATE "org_signup_requests"  SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

-- ── Keep it that way ─────────────────────────────────────────────────────────
-- The existing unique index on users.email is case-sensitive, so it would still
-- permit "Kesava@x.com" alongside "kesava@x.com" if any future code path
-- bypassed the application-level normalisation. A functional unique index on
-- lower(email) makes the guarantee structural rather than a convention every
-- new controller has to remember.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));
CREATE UNIQUE INDEX "portal_users_org_email_lower_key" ON "portal_users" ("org_id", lower("email"));
