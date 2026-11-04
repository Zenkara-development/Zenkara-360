import { Response, NextFunction } from 'express';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { assertEntityInOrg } from '../../utils/entityAccess';
import { assertUploadAllowed, sanitiseFilename, UPLOAD_POLICY } from '../../utils/uploadPolicy';
import * as storage from '../../utils/storage';

const include = { uploader: { select: { id: true, name: true, avatarUrl: true } } };

/**
 * Loads one attachment, scoped to the caller's org.
 *
 * The org check runs through `uploader.orgId` rather than through the parent
 * record. That is the important difference from the previous code, which
 * called assertEntityInOrg() on every single-attachment operation: once the
 * parent record was deleted, that check 404'd, so the attachment could never
 * be downloaded *or* deleted again — while still occupying the org's storage
 * quota. Scoping on the uploader is just as strict a tenant boundary (a User
 * belongs to exactly one org) and does not depend on the parent still being
 * there.
 */
async function loadForOrg(id: string, orgId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id, uploader: { orgId } },
  });
  if (!attachment) throw new AppError(404, 'Attachment not found');
  return attachment;
}

/** So the client's file picker and its error messages agree with the server. */
export async function policy(_req: AuthRequest, res: Response) {
  res.json(UPLOAD_POLICY);
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityType, entityId } = req.params;
    await assertEntityInOrg(entityType, entityId, req.user!.orgId);
    const attachments = await prisma.attachment.findMany({
      where: { entityType: entityType as any, entityId },
      include,
      orderBy: { createdAt: 'desc' },
    });
    res.json(attachments);
  } catch (err) { next(err); }
}

export async function upload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityType, entityId } = req.params;
    await assertEntityInOrg(entityType, entityId, req.user!.orgId);

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) throw new AppError(400, 'No file uploaded');

    // Second pass. The route's fileFilter already ran this on the name, but
    // only here do we know the final byte count, and only here does the name
    // we are about to persist get fixed. `originalname` is attacker-supplied
    // and used to be written straight into both `fileName` and the S3 object
    // key, where a `../` segment could climb out of the `${orgId}/` prefix
    // that is the only thing separating tenants in the shared bucket.
    const fileName = sanitiseFilename(file.originalname);
    assertUploadAllowed(fileName, file.size);

    // Uploads to wherever the org connected in Settings → Storage (Google
    // Drive today) — throws a clear 400 if nothing's connected yet, before
    // any DB row is written.
    const uploaded = await storage.uploadAttachment(req.user!.orgId, {
      buffer: file.buffer,
      filename: fileName,
      mimeType: file.mimetype,
    });

    try {
      const attachment = await prisma.attachment.create({
        data: {
          entityType: entityType as any,
          entityId,
          uploaderId: req.user!.id,
          fileName,
          fileUrl: uploaded.fileUrl,
          provider: uploaded.provider,
          providerFileId: uploaded.providerFileId,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
        include,
      });
      res.status(201).json(attachment);
    } catch (err) {
      // The bytes are already in Drive/S3 at this point. Without this the
      // file would sit there forever with no row pointing at it — invisible
      // to the customer, but still counting against their storage quota.
      await storage.deleteAttachmentFile(req.user!.orgId, uploaded.provider, uploaded.providerFileId)
        .catch(() => {});
      throw err;
    }
  } catch (err) { next(err); }
}

/** Streams the file's bytes back through our own backend rather than
 * redirecting to a Drive link — keeps access controlled by our own
 * entity/org check instead of Google Drive sharing permissions, and works
 * for staff regardless of whether they have any Google account at all. */
export async function download(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const attachment = await loadForOrg(req.params.id, req.user!.orgId);

    const buffer = await storage.downloadAttachment(req.user!.orgId, attachment.provider, attachment.providerFileId);
    res.setHeader('Content-Type', attachment.mimeType);
    // RFC 6266: a plain ASCII fallback plus the real UTF-8 name. The old
    // single percent-encoded `filename=` meant anyone downloading
    // "Q3 réport.pdf" got "Q3%20r%C3%A9port.pdf" saved literally.
    const safe = sanitiseFilename(attachment.fileName);
    const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    );
    res.send(buffer);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const attachment = await loadForOrg(req.params.id, req.user!.orgId);
    if (attachment.uploaderId !== req.user!.id && req.user!.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Not allowed');
    }

    // Row first would strand the blob; blob first would strand the row if the
    // DB call failed. Blob-first is the right order because a stranded row is
    // recoverable (the reaper or a retry finds it) while a stranded blob is
    // not — nothing records that it exists.
    await storage.deleteAttachmentFile(req.user!.orgId, attachment.provider, attachment.providerFileId);
    await prisma.attachment.delete({ where: { id: attachment.id } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
