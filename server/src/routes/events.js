import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { addConnection } from '../lib/events.js';

const router = Router();

/**
 * Live-update stream for the signed-in user's open pages (Server-Sent Events).
 * Only an "update" signal is sent — the page then reads its data through the normal API.
 */
router.get('/', requireAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop reverse proxies (nginx) from holding the stream back
  });
  res.flushHeaders();
  res.write('retry: 4000\n: connected\n\n');

  const remove = addConnection({ res, userId: req.user.id, role: req.user.role });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000); // keeps the connection open through proxies
  req.on('close', () => {
    clearInterval(heartbeat);
    remove();
  });
});

export default router;
