import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { sseManager, SSEEvent } from '../../utils/sse';

const router = Router();

// GET /api/events/stream?_t=<jwt>
// EventSource cannot send headers, so we accept the JWT via query param.
router.get('/stream', (req: Request, res: Response) => {
  const token = (req.query._t as string) || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });

  let payload: { id: string; orgId: string; role: string };
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { id: userId, orgId } = payload;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sseManager.add(orgId, userId, res);

  // Initial ping
  res.write(`event: ${SSEEvent.PING}\ndata: {"ts":${Date.now()},"orgId":"${orgId}"}\n\n`);

  // Keep-alive every 25s
  const keepAlive = setInterval(() => {
    try {
      res.write(`event: ${SSEEvent.PING}\ndata: {"ts":${Date.now()}}\n\n`);
    } catch {
      clearInterval(keepAlive);
    }
  }, 25_000);

  req.on('close', () => clearInterval(keepAlive));
});

export { router as eventsRouter };
