-- Ticket.contactId: lets an agent create a ticket "on behalf of" a CRM
-- Contact (rather than only an internal User via requesterId). Nullable —
-- most tickets still have no linked Contact. Also becomes the target for
-- SEND_CSAT_SURVEY / SEND_WHATSAPP automations' "the linked contact"
-- recipient option (see notification-recipient.ts).
ALTER TABLE "tickets" ADD COLUMN "contact_id" TEXT;

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tickets_contact_id_idx" ON "tickets"("contact_id");
