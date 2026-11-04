import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireRole, ALL_STAFF } from '../../middleware/authenticate';
import { assertUploadAllowed, MAX_UPLOAD_BYTES } from '../../utils/uploadPolicy';
import * as c from './attachments.controller';

// Memory storage only — the buffer goes straight to storage.uploadAttachment()
// (the org's connected Drive), never touching this server's local disk,
// which Render wipes on every redeploy/restart.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  // Rejecting here rather than only in the controller matters: multer buffers
  // the whole file into memory, so a filter that runs at the *start* of the
  // part means a 20MB .exe is never held in RAM at all. The controller checks
  // again anyway, since this is the only thing standing between an
  // `originalname` and an S3 object key.
  fileFilter: (_req, file, cb) => {
    try {
      assertUploadAllowed(file.originalname);
      cb(null, true);
    } catch (err) {
      cb(err as Error);
    }
  },
});

export const attachmentsRouter = Router();
attachmentsRouter.use(authenticate);

// Same access level as Comments (ALL_STAFF — everyone but plain EMPLOYEE).
// /:id/download must be registered before /:entityType/:entityId — both are
// 2-segment GET paths, and Express matches whichever pattern was registered
// first, so the more specific literal route has to come first or every
// download request would get swallowed by the list handler instead
// (entityType='<the id>', entityId='download').
attachmentsRouter.get('/policy',                   requireRole(...ALL_STAFF), c.policy);
attachmentsRouter.get('/:id/download',             requireRole(...ALL_STAFF), c.download);
attachmentsRouter.delete('/:id',                   requireRole(...ALL_STAFF), c.remove);
attachmentsRouter.get('/:entityType/:entityId',    requireRole(...ALL_STAFF), c.list);
attachmentsRouter.post('/:entityType/:entityId',   requireRole(...ALL_STAFF), upload.single('file'), c.upload);
