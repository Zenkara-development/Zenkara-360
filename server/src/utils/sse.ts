import { Response } from 'express';

// ─── SSE Manager ─────────────────────────────────────────────────────────────
// Tracks open SSE connections per org. Lets any controller broadcast an event
// to all connected clients in the same org without any external dependency.

interface SSEClient {
  res: Response;
  userId: string;
}

class SSEManager {
  private clients = new Map<string, Set<SSEClient>>(); // orgId → clients

  /** Register a new SSE response stream for an org member */
  add(orgId: string, userId: string, res: Response) {
    if (!this.clients.has(orgId)) this.clients.set(orgId, new Set());
    const client: SSEClient = { res, userId };
    this.clients.get(orgId)!.add(client);

    // Remove when connection closes
    res.on('close', () => {
      this.clients.get(orgId)?.delete(client);
      if (this.clients.get(orgId)?.size === 0) this.clients.delete(orgId);
    });

    return client;
  }

  /** Broadcast an event to all clients in an org (optionally skip the sender) */
  broadcast(orgId: string, event: string, data: any, skipUserId?: string) {
    const org = this.clients.get(orgId);
    if (!org) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of org) {
      if (skipUserId && client.userId === skipUserId) continue;
      try {
        client.res.write(payload);
      } catch {
        org.delete(client);
      }
    }
  }

  /** True when the user has at least one live SSE connection (i.e. the app is open somewhere). */
  isUserConnected(orgId: string, userId: string): boolean {
    const org = this.clients.get(orgId);
    if (!org) return false;
    for (const c of org) if (c.userId === userId) return true;
    return false;
  }

  /** Broadcast to ALL clients in org including sender */
  broadcastAll(orgId: string, event: string, data: any) {
    this.broadcast(orgId, event, data);
  }

  /** Send an event to specific users only — required for DM chat, where an
      org-wide broadcast of message content would leak private conversations
      to every connected employee. */
  sendToUsers(orgId: string, userIds: string[], event: string, data: any) {
    const org = this.clients.get(orgId);
    if (!org) return;
    const targets = new Set(userIds);
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of org) {
      if (!targets.has(client.userId)) continue;
      try { client.res.write(payload); } catch { org.delete(client); }
    }
  }

  connectedCount(orgId: string) {
    return this.clients.get(orgId)?.size ?? 0;
  }

  /**
   * Ends every open stream. Called on shutdown: server.close() waits for all
   * connections to drain, and an SSE stream is held open indefinitely by
   * design — so without this, every deploy/restart sat out the full
   * forced-exit timeout and exited non-zero instead of closing cleanly.
   * Clients auto-reconnect (EventSource retries), so ending the stream is
   * invisible to users beyond a momentary gap.
   */
  closeAll() {
    for (const org of this.clients.values()) {
      for (const client of org) {
        try { client.res.end(); } catch { /* connection already gone */ }
      }
    }
    this.clients.clear();
  }
}

export const sseManager = new SSEManager();

// ─── Event type helpers ───────────────────────────────────────────────────────

export const SSEEvent = {
  TICKET_CREATED:     'ticket:created',
  TICKET_UPDATED:     'ticket:updated',
  TICKET_STATUS:      'ticket:status',
  INBOX_MESSAGE:      'inbox:message',
  INBOX_CONVERSATION: 'inbox:conversation',
  LEAD_CREATED:       'lead:created',
  DEAL_UPDATED:       'deal:updated',
  NOTIFICATION:       'notification',
  ATTENDANCE_UPDATED: 'attendance:updated',
  ATTENDANCE_LOCATE:  'attendance:locate',   // sent to one user: "send a location ping now"
  LEAVE_UPDATED:      'leave:updated',
  CHAT_MESSAGE:       'chat:message',
  CHAT_THREAD:        'chat:thread',
  PING:               'ping',
} as const;
