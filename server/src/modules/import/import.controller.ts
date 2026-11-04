import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';

// ─── Simple CSV parser (no external package) ──────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    // Handle quoted fields
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; continue; }
      if (line[i] === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
      current += line[i];
    }
    values.push(current.trim());
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').replace(/"/g, '')]));
  });
}

// ─── Import contacts ──────────────────────────────────────────────────────────

export async function importContacts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { csv, preview } = z.object({
      csv:     z.string().min(1),
      preview: z.boolean().default(false),
    }).parse(req.body);

    const rows = parseCSV(csv);
    if (!rows.length) throw new AppError(400, 'No rows found in CSV');

    // Detect required columns
    const sample = rows[0];
    if (!('name' in sample) && !('email' in sample)) {
      throw new AppError(400, 'CSV must have at least "name" or "email" column');
    }

    if (preview) return res.json({ rows: rows.slice(0, 5), total: rows.length });

    let created = 0, updated = 0, errors = 0;
    for (const row of rows) {
      try {
        const name     = row.name || row.full_name || row.contact_name || 'Unknown';
        const email    = row.email || row.email_address || undefined;
        const phone    = row.phone || row.phone_number || undefined;
        const jobTitle = row.job_title || row.title || row.company || undefined; // map company→jobTitle as best-effort

        if (email) {
          const existing = await prisma.contact.findFirst({ where: { orgId, email } });
          if (existing) {
            await prisma.contact.update({ where: { id: existing.id }, data: { name, phone, jobTitle } });
            updated++;
          } else {
            await prisma.contact.create({ data: { orgId, name, email, phone, jobTitle, ownerId: req.user!.id } });
            created++;
          }
        } else {
          await prisma.contact.create({ data: { orgId, name, phone, jobTitle, ownerId: req.user!.id } });
          created++;
        }
      } catch { errors++; }
    }

    res.json({ message: 'Import complete', created, updated, errors, total: rows.length });
  } catch (err) { next(err); }
}

// ─── Import leads ─────────────────────────────────────────────────────────────

export async function importLeads(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { csv, preview } = z.object({
      csv:     z.string().min(1),
      preview: z.boolean().default(false),
    }).parse(req.body);

    const rows = parseCSV(csv);
    if (!rows.length) throw new AppError(400, 'No rows found in CSV');

    if (preview) return res.json({ rows: rows.slice(0, 5), total: rows.length });

    let created = 0, errors = 0;
    for (const row of rows) {
      try {
        const name     = row.name || row.full_name || row.contact_name || 'Unknown';
        const email    = row.email || row.email_address || undefined;
        const source   = row.source || row.lead_source || undefined;
        const phone    = row.phone || undefined;
        const jobTitle = row.job_title || row.title || row.company || undefined;

        // Upsert contact first
        let contact = email
          ? await prisma.contact.findFirst({ where: { orgId, email } })
          : null;

        if (!contact) {
          contact = await prisma.contact.create({
            data: { orgId, name, email, phone, jobTitle, ownerId: req.user!.id },
          });
        }

        await prisma.lead.create({
          data: { orgId, contactId: contact.id, source, assignedTo: req.user!.id },
        });
        created++;
      } catch { errors++; }
    }

    res.json({ message: 'Import complete', created, errors, total: rows.length });
  } catch (err) { next(err); }
}
