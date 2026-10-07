import { env, emailConfigured, emailProvider, settings, siteDir, isProd } from './config/env.js';
import { checkEmailSetup } from './services/email/transport.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`\n★ STAR PRODUCTION running on port ${env.PORT} — ${isProd ? env.APP_URL : `http://localhost:${env.PORT}`}  (admin: ${isProd ? env.APP_URL : `http://localhost:${env.PORT}`}/admin)`);
  console.log(`  Website files: ${siteDir}`);
  if (!emailConfigured) console.warn('  ! No email provider set (SMTP_HOST or BREVO_API_KEY) — emails are only printed here, and new accounts are verified at sign-up.');
  else console.log('  Email: ' + emailProvider + (settings.requireEmailVerification ? ' · clients must verify their email before logging in' : ' · email verification is off'));
  checkEmailSetup().then((r) => { if (emailConfigured && !r.ok) console.warn('  ! Email is NOT working: ' + r.error); });
});

// Periodically clear expired sessions and reset tokens.
const cleanup = setInterval(
  () => {
    const now = new Date();
    Promise.all([
      prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]).catch((err) => console.error('[cleanup]', err.message));
  },
  60 * 60 * 1000,
);
cleanup.unref();

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
