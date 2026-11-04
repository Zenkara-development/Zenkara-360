import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { getVapidPublicKey } from '../../utils/webPush';

/** GET /push/vapid-public-key — the client needs this to call pushManager.subscribe(). 404s (not an empty 200) when unconfigured, so the client can distinguish "not set up yet" from "here's the key". */
export async function getVapidKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const key = getVapidPublicKey();
    if (!key) { res.status(404).json({ message: 'Push notifications are not configured on this server.' }); return; }
    res.json({ publicKey: key });
  } catch (err) { next(err); }
}

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** POST /push/subscribe — upserted on endpoint (unique): a browser re-subscribing after a permission reset or reinstall always belongs to whoever is logged in now. */
export async function subscribe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { endpoint, keys } = SubscribeSchema.parse(req.body);
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: req.user!.id, orgId: req.user!.orgId, p256dh: keys.p256dh, auth: keys.auth },
      create: { endpoint, userId: req.user!.id, orgId: req.user!.orgId, p256dh: keys.p256dh, auth: keys.auth },
    });
    res.status(201).json({ message: 'Subscribed' });
  } catch (err) { next(err); }
}

/** POST /push/unsubscribe — scoped to the caller's own subscription so one user can't unsubscribe another's device by guessing an endpoint. */
export async function unsubscribe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.id } });
    res.json({ message: 'Unsubscribed' });
  } catch (err) { next(err); }
}
