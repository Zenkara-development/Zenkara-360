import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { sanitizeRichText } from '../../../utils/sanitizeHtml';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { parsePagination, paginate } from '../../../utils/pagination';

const Schema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  // The "— none —" option in the category <select> submits '' rather than
  // omitting the field; without this coercion Prisma tries to link a
  // Category row with id '', which violates the FK constraint and 500s
  // (same fix already applied in contacts/deals/leads/tickets controllers).
  // Also accepts null: editing an article re-submits the full fetched
  // article, and an uncategorized article's categoryId comes back from
  // Prisma as null (not omitted) — without .nullable() that 400s too
  // (same issue as the Business Context categoryId/terminology fields).
  categoryId: z.string().nullable().optional().or(z.literal('')).transform(v => v || undefined),
  status: z.enum(['DRAFT','PUBLISHED','ARCHIVED']).optional(),
});

const include = {
  author: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
};

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { status, search } = req.query as Record<string, string>;
    const where: any = { orgId };
    if (status) where.status = status;
    else where.status = 'PUBLISHED';
    if (search) where.title = { contains: search, mode: 'insensitive' };
    if (['IT_AGENT','IT_MANAGER','SUPER_ADMIN'].includes(req.user!.role) && req.query.all) delete where.status;
    const pag = parsePagination(req);
    const [articles, total] = await Promise.all([
      prisma.knowledgeArticle.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: pag.limit, skip: pag.skip }),
      prisma.knowledgeArticle.count({ where }),
    ]);
    res.json(paginate(articles, total, pag));
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.parse(req.body);
    data.body = sanitizeRichText(data.body);
    const article = await prisma.knowledgeArticle.create({
      data: { ...data, orgId: req.user!.orgId, authorId: req.user!.id, publishedAt: data.status === 'PUBLISHED' ? new Date() : undefined },
      include
    });
    res.status(201).json(article);
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const article = await prisma.knowledgeArticle.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId }, include });
    if (!article) throw new AppError(404, 'Article not found');
    res.json(article);
  } catch (err) { next(err); }
}

/* Words too common to signal topic. Keeping this list tiny is deliberate —
   it only needs to stop "my printer is not working" matching every article
   containing "not", not to be a linguistics project. */
const STOPWORDS = new Set([
  'the','and','for','with','not','are','was','has','have','had','can','cant',
  'this','that','when','what','how','why','does','doesnt','wont','from','into',
  'its','all','any','but','out','get','got','new','issue','problem','error',
  'help','need','please','working','work','after','before',
]);

/**
 * Lightweight "you might already have the answer" lookup used by the ticket
 * create form (deflection) — NOT a general search. Splits the draft title +
 * description into keywords, finds PUBLISHED articles containing any of them,
 * then ranks in JS: a keyword hit in the title counts double a hit in the
 * body. Returns at most 5, each with a snippet around the first body match.
 * Open to every authenticated role — the requester filing the ticket is
 * exactly who deflection is for.
 */
export async function suggest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 4) return res.json({ suggestions: [] });

    const words = Array.from(new Set(
      q.toLowerCase().split(/[^a-z0-9]+/)
        .filter(w => w.length >= 3 && !STOPWORDS.has(w)),
    )).slice(0, 10);
    if (!words.length) return res.json({ suggestions: [] });

    const candidates = await prisma.knowledgeArticle.findMany({
      where: {
        orgId: req.user!.orgId,
        status: 'PUBLISHED',
        OR: words.flatMap(w => [
          { title: { contains: w, mode: 'insensitive' as const } },
          { body:  { contains: w, mode: 'insensitive' as const } },
        ]),
      },
      include: { category: { select: { id: true, name: true } } },
      take: 25,
    });

    const scored = candidates.map(a => {
      const title = a.title.toLowerCase();
      /* Articles may now be rich HTML — match and snippet against the plain
         text so tags don't break keyword hits and the collapsed preview
         doesn't show "<p>" fragments or a base64 image dump. */
      const plain = a.body
        .replace(/<img[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const body = plain.toLowerCase();
      let score = 0;
      let firstBodyHit = -1;
      for (const w of words) {
        if (title.includes(w)) score += 2;
        const i = body.indexOf(w);
        if (i >= 0) { score += 1; if (firstBodyHit < 0 || i < firstBodyHit) firstBodyHit = i; }
      }
      // Snippet: a window around the first body match, else the opening line.
      const from = firstBodyHit < 0 ? 0 : Math.max(0, firstBodyHit - 40);
      const raw = plain.slice(from, from + 180).trim();
      const snippet = (from > 0 ? '…' : '') + raw + (from + 180 < plain.length ? '…' : '');
      return { id: a.id, title: a.title, snippet, body: a.body, category: a.category, score };
    }).filter(s => s.score > 0);

    scored.sort((x, y) => y.score - x.score);
    res.json({ suggestions: scored.slice(0, 5).map(({ score: _s, ...rest }) => rest) });
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    if (data.body) data.body = sanitizeRichText(data.body);
    await prisma.knowledgeArticle.updateMany({ where: { id: req.params.id, orgId: req.user!.orgId }, data: { ...data, publishedAt: data.status === 'PUBLISHED' ? new Date() : undefined } });
    const article = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id }, include });
    res.json(article);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.knowledgeArticle.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
