import { prisma } from './prisma';

/**
 * Shared "who gets this WhatsApp message" resolution, used by both the
 * Schedule poller and the workflow engine's SEND_WHATSAPP action so the
 * four recipient options behave identically everywhere they're offered.
 */
export type RecipientType = 'CONTACT' | 'ASSIGNEE' | 'CUSTOM_NUMBER' | 'ORG_DEFAULT' | 'REFERENCE_FIELD';

export async function resolveRecipientPhone(opts: {
  orgId: string;
  entityType: 'TICKET' | 'DEAL' | 'CONTACT' | 'CUSTOM_MODULE_RECORD';
  entityId: string;
  recipientType: RecipientType;
  customNumber?: string | null;
  /** Required when recipientType === 'REFERENCE_FIELD' — a CustomField of
   *  fieldType REFERENCE, whose stored value is a Contact id. */
  referenceFieldId?: string | null;
}): Promise<string> {
  const { orgId, entityType, entityId, recipientType, customNumber, referenceFieldId } = opts;

  switch (recipientType) {
    case 'CUSTOM_NUMBER': {
      if (!customNumber) throw new Error('No custom phone number was provided.');
      return customNumber;
    }

    case 'ORG_DEFAULT': {
      const waConfig = await prisma.whatsAppConfig.findUnique({ where: { orgId } });
      const number = waConfig?.notifyNumber || waConfig?.phoneNumber;
      if (!number) throw new Error('No WhatsApp account connected for this organization. Go to Inbox → Settings.');
      return number;
    }

    case 'CONTACT': {
      // Tickets can now optionally link to a CRM Contact too — see
      // Ticket.contactId (set when an agent files a ticket "on behalf of" a
      // contact, tickets.controller.ts's create()). A CONTACT entity
      // (birthday/date automations, see dateAutomation.ts) is trivially its
      // own contact. CUSTOM_MODULE_RECORD has no linked contact at all —
      // use CUSTOM_NUMBER with a "{{phone}}" template against one of the
      // module's own fields instead.
      if (entityType === 'CONTACT') {
        const contact = await prisma.contact.findFirst({ where: { id: entityId, orgId }, select: { phone: true } });
        if (!contact?.phone) throw new Error('This contact has no phone number on file.');
        return contact.phone;
      }
      if (entityType === 'TICKET') {
        const ticket = await prisma.ticket.findFirst({ where: { id: entityId, orgId }, select: { contact: { select: { phone: true } } } });
        if (!ticket?.contact?.phone) throw new Error('This ticket has no linked contact with a phone number on file.');
        return ticket.contact.phone;
      }
      if (entityType !== 'DEAL') {
        throw new Error(`Only deals and tickets (and contacts themselves) have a linked contact to notify — not ${entityType}. Choose a different recipient.`);
      }
      const deal = await prisma.deal.findFirst({
        where: { id: entityId, orgId },
        select: { contact: { select: { phone: true } } },
      });
      if (!deal?.contact?.phone) {
        throw new Error('This deal has no linked contact with a phone number on file.');
      }
      return deal.contact.phone;
    }

    case 'REFERENCE_FIELD': {
      if (!referenceFieldId) throw new Error('No reference field was selected.');
      const field = await prisma.customField.findFirst({ where: { id: referenceFieldId, orgId, fieldType: 'REFERENCE' } });
      if (!field) throw new Error('The selected reference field no longer exists.');
      const fieldValue = await prisma.customFieldValue.findUnique({
        where: { customFieldId_entityId: { customFieldId: referenceFieldId, entityId } },
      });
      if (!fieldValue?.value) throw new Error(`"${field.label}" is not set on this record.`);
      const contact = await prisma.contact.findFirst({ where: { id: fieldValue.value, orgId }, select: { phone: true } });
      if (!contact?.phone) throw new Error('The linked contact has no phone number on file.');
      return contact.phone;
    }

    case 'ASSIGNEE': {
      let assignedTo: string | null = null;
      if (entityType === 'TICKET') {
        const ticket = await prisma.ticket.findFirst({ where: { id: entityId, orgId }, select: { assignedTo: true } });
        assignedTo = ticket?.assignedTo ?? null;
      } else if (entityType === 'DEAL') {
        const deal = await prisma.deal.findFirst({ where: { id: entityId, orgId }, select: { assignedTo: true } });
        assignedTo = deal?.assignedTo ?? null;
      } else if (entityType === 'CONTACT') {
        const contact = await prisma.contact.findFirst({ where: { id: entityId, orgId }, select: { ownerId: true } });
        assignedTo = contact?.ownerId ?? null;
      } else {
        throw new Error('CUSTOM_MODULE_RECORD has no assignee — choose a different recipient.');
      }
      if (!assignedTo) throw new Error('This record has no assigned user to notify.');

      const user = await prisma.user.findUnique({ where: { id: assignedTo }, select: { phone: true } });
      if (!user?.phone) throw new Error('The assigned user has no phone number on file.');
      return user.phone;
    }

    default:
      throw new Error(`Unknown recipient type: ${recipientType}`);
  }
}
