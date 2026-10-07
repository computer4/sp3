import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env, isProd, siteDir } from './config/env.js';
import { cors, originCheck } from './middleware/originCheck.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import planRoutes from './routes/plans.js';
import orderRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import chatRoutes from './routes/chat.js';
import eventsRoutes from './routes/events.js';

// The website is the single file index.html (+ Photos/ and data/) in SITE_DIR (the project folder).
const rootDir = siteDir;
const indexFile = path.join(rootDir, 'index.html');

/**
 * CSP hashes for index.html's inline <script> blocks, so inline code is allowed only if it is
 * exactly what's in the file. Re-read when the file changes (no restart needed while editing).
 */
let hashCache = { mtimeMs: -1, value: '' };
function inlineScriptHashes() {
  try {
    const { mtimeMs } = fs.statSync(indexFile);
    if (mtimeMs !== hashCache.mtimeMs) {
      const html = fs.readFileSync(indexFile, 'utf8');
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`,
      );
      hashCache = { mtimeMs, value: hashes.join(' ') };
    }
  } catch {
    hashCache = { mtimeMs: -1, value: '' };
  }
  return hashCache.value;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", () => inlineScriptHashes()],
          'connect-src': ["'self'"],
          'form-action': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
          'upgrade-insecure-requests': isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());

  // The payment screenshot is a (compressed) image sent as JSON — allow a bigger body for that one route only.
  app.use(/^\/api\/orders\/(?:upgrades\/)?[^/]+\/payment-proof\/?$/, express.json({ limit: '3mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', cors, apiLimiter, originCheck, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/plans', planRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api', notFound);

  // ── Website ─────────────────────────────────────────────
  // Only these folders are public. The project root itself (with .env) is never served.
  app.use('/Photos', express.static(path.join(rootDir, 'Photos'), { maxAge: isProd ? '1d' : 0 }));
  app.use('/data', express.static(path.join(rootDir, 'data'), { maxAge: 0 }));
  // The chat widget script (explicit route: the project root itself is never served).
  app.get('/chat-widget.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(rootDir, 'chat-widget.js'));
  });
  const sendIndex = (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  };
  app.get(['/', '/index.html'], sendIndex);
  // The dashboard and the admin panel are their own pages (/dashboard, /admin or the .html files).
  app.use('/assets', express.static(path.join(rootDir, 'assets'), { maxAge: isProd ? '1h' : 0 }));
  for (const page of ['dashboard', 'admin', 'pay', 'verify']) {
    const file = path.join(rootDir, `${page}.html`);
    app.get([`/${page}`, `/${page}.html`], (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(file);
    });
  }
  // Friendly URLs for the login pages (these live inside the website as #/hash routes).
  for (const page of ['login', 'signup']) {
    app.get(`/${page}`, (req, res) => res.redirect(`/#/${page}`));
  }
  // Any other page path goes back to the home page.
  app.get('/{*splat}', (req, res) => {
    // File-like or hidden paths (/.env, /server/app.js, …) are a plain 404 — nothing outside Photos/ and data/ is served.
    if (path.extname(req.path) || /\/\./.test(req.path)) return res.status(404).send('Not found');
    res.redirect('/');
  });

  app.use(errorHandler);
  return app;
}
