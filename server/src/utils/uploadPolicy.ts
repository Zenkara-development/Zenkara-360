import path from 'node:path';
import { AppError } from '../middleware/errorHandler';

/**
 * What may be uploaded, and under what name.
 *
 * The attachment route previously had no `fileFilter` at all and passed
 * `file.originalname` straight through — into the stored `fileName`, and into
 * the S3 object key. Two consequences worth naming:
 *
 * 1. The shared hosted bucket separates tenants ONLY by an `${orgId}/` key
 *    prefix. `S3_ENDPOINT` is explicitly supported for MinIO and self-hosted
 *    gateways, some of which normalise `..` in a key — so a filename like
 *    `../../other-org/x.pdf` could climb out of its own tenant's prefix.
 *    Real AWS and R2 treat `..` as a literal segment and are unaffected, but
 *    the separation should not depend on which vendor is behind the endpoint.
 *
 * 2. Anything at all could be stored — `.exe`, `.html`, `.svg`. Downloads are
 *    served with `Content-Disposition: attachment` and helmet's `nosniff`, so
 *    this is not stored XSS on the API origin, but hosting arbitrary
 *    executables for customers is not a thing to do by accident.
 */

/** Extensions customers actually attach to CRM and service-desk records. */
const ALLOWED_EXTENSIONS = new Set([
  // documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  '.txt', '.md', '.rtf', '.csv', '.tsv',
  // images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic',
  // archives
  '.zip', '.gz', '.tar', '.7z',
  // mail / calendar / logs
  '.eml', '.msg', '.ics', '.log', '.json', '.xml',
  // media (screen recordings on tickets are common)
  '.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a',
]);

/**
 * Blocked outright, whatever the extension says. Kept separate from the
 * allowlist because these are the ones worth an explicit message.
 */
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl',
  '.jar', '.app', '.dmg', '.deb', '.rpm', '.sh', '.ps1', '.vbs', '.wsf',
  '.dll', '.so', '.jsp', '.php', '.asp', '.aspx', '.cgi',
  // SVG can carry script. It is an image people reasonably attach, but it is
  // also the one image format that is a document — excluded deliberately.
  '.svg', '.svgz', '.html', '.htm', '.xhtml', '.hta',
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Strips every path component and anything that could be interpreted as one.
 * Returns a name safe to use as a storage key segment and as a download
 * filename.
 */
export function sanitiseFilename(original: string): string {
  // basename() on both separators — a Windows client sends `C:\Users\…\x.pdf`
  // and POSIX basename() would keep the whole thing as one "name".
  const base = path.basename(original.replace(/\\/g, '/')).trim();

  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')   // control chars, incl. NUL
    .replace(/[/\\:*?"<>|]/g, '_')            // path + Windows-reserved
    .replace(/^\.+/, '')                      // no leading dots: no `..`, no hidden files
    .replace(/\s+/g, ' ')
    .slice(0, 180);

  return cleaned || 'file';
}

/**
 * Throws unless this file may be stored. Called from the route's multer
 * fileFilter (so an oversized or forbidden file is rejected before the body
 * is fully buffered) and again in the controller as a belt-and-braces check.
 */
export function assertUploadAllowed(filename: string, sizeBytes?: number): void {
  const safe = sanitiseFilename(filename);
  const ext = path.extname(safe).toLowerCase();

  if (!ext) {
    throw new AppError(400, 'That file has no extension, so we cannot tell what it is. Rename it and try again.');
  }
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new AppError(400, `${ext} files cannot be attached for security reasons.`);
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AppError(400, `${ext} files are not supported. Attach a document, image, archive or media file.`);
  }
  if (sizeBytes !== undefined && sizeBytes > MAX_UPLOAD_BYTES) {
    throw new AppError(413, 'That file is larger than the 25MB limit.');
  }
}

/** For the client, so the file picker and its error messages agree with the server. */
export const UPLOAD_POLICY = {
  maxBytes: MAX_UPLOAD_BYTES,
  allowedExtensions: [...ALLOWED_EXTENSIONS].sort(),
};
