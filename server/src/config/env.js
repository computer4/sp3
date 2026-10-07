// Loads and validates environment variables. Server-only — never sent to the browser.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// START.bat runs the server from a local copy and points these back at the project folder.
const envFile = process.env.STAR_ENV_FILE || path.join(projectDir, '.env');
// Real environment variables (e.g. set by the host or START.bat) always win over the .env file.
// Mail credentials can live in their own file (`.env.email`, next to .env) so they are easy to paste and keep private.
// Filled-in lines there win over .env; blank lines are ignored. (Host environment variables still win over both.)
try {
  const emailFile = path.join(path.dirname(envFile), '.env.email');
  if (fs.existsSync(emailFile)) {
    for (const [k, v] of Object.entries(dotenv.parse(fs.readFileSync(emailFile)))) {
      if (v.trim() !== '' && process.env[k] === undefined) process.env[k] = v.trim();
    }
  }
} catch { /* an unreadable mail file just means the .env values are used */ }
dotenv.config({ path: envFile, quiet: true });

const emptyToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = z.preprocess(emptyToUndefined, z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:4000'),
  // Extra browser origins allowed to call the API with cookies (e.g. VS Code Live Server).
  CORS_ORIGINS: optional,
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // Folder that holds index.html, Photos/ and data/ (defaults to the project folder).
  SITE_DIR: z.preprocess(emptyToUndefined, z.string().default(projectDir)),

  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().default('file:./star.db')),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  EMAIL_API_KEY: optional, // SMTP password (for Gmail: an App Password)
  EMAIL_FROM: z.string().default('STAR PRODUCTION <no-reply@example.com>'),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.preprocess((v) => String(v ?? 'true').toLowerCase() === 'true', z.boolean()),
  SMTP_USER: optional,
  // Email by HTTPS API instead of SMTP — for hosts that block SMTP ports (many free tiers). Brevo (brevo.com) sends from a
  // verified sender address such as the studio's Gmail, no domain needed.
  // Clients must click the link in the verification email before they can log in. Turn off only if you can't send email.
  REQUIRE_EMAIL_VERIFICATION: z.preprocess((v) => String(v ?? 'true').toLowerCase() !== 'false', z.boolean()),
  BREVO_API_KEY: optional,
  EMAIL_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['smtp', 'brevo']).optional()),
  ADMIN_NOTIFY_EMAIL: optional,

  // The two official staff accounts (created / kept up to date by the seed on every start).
  //   MAIN admin  → every client detail, projects, messages… but can NOT confirm payments
  //   SIDE admin  → payments (and confirms them), messages, the overview numbers
  MAIN_ADMIN_NAME: optional,
  MAIN_ADMIN_EMAIL: optional,
  MAIN_ADMIN_PASSWORD: optional,
  SIDE_ADMIN_NAME: optional,
  SIDE_ADMIN_EMAIL: optional,
  SIDE_ADMIN_PASSWORD: optional,
  // (older single-admin settings — still understood as the main admin)
  ADMIN_NAME: optional,
  ADMIN_EMAIL: optional,
  ADMIN_PASSWORD: optional,
});

function fail(lines) {
  console.error('\n✗ Invalid environment configuration (check your .env file):');
  for (const l of lines) console.error(`  - ${l}`);
  console.error('');
  process.exit(1);
}

const parsed = schema.safeParse(process.env);
if (!parsed.success) fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));

export const env = parsed.data;
process.env.DATABASE_URL = env.DATABASE_URL; // Prisma reads it from process.env
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const siteDir = path.resolve(env.SITE_DIR);

if (isProd && !env.APP_URL.startsWith('https://')) {
  fail(['APP_URL must be your public https:// address in production (for example https://starproduction.in) — login cookies and links in emails depend on it.']);
}
if (isProd && env.TRUST_PROXY === 0) {
  console.warn('  ! TRUST_PROXY=0 in production. Behind a host/proxy (Render, Railway, Fly, nginx…) set TRUST_PROXY=1 so rate limits see real visitor IPs.');
}
export const appOrigin = new URL(env.APP_URL).origin;
const defaultDevOrigins = isProd ? [] : ['http://localhost:5500', 'http://127.0.0.1:5500'];
/** Every origin allowed to make credentialed API requests. */
export const allowedOrigins = new Set([
  appOrigin,
  ...defaultDevOrigins,
  ...(env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => new URL(o).origin),
]);
/** How emails leave the server: the Brevo HTTPS API, SMTP (e.g. Gmail), or — when neither is set — the console. */
export const emailProvider = env.EMAIL_PROVIDER ?? (env.BREVO_API_KEY ? 'brevo' : env.SMTP_HOST ? 'smtp' : 'console');
export const emailConfigured = (emailProvider === 'brevo' && Boolean(env.BREVO_API_KEY)) || (emailProvider === 'smtp' && Boolean(env.SMTP_HOST));

/**
 * Whether new clients must verify their email before logging in. Needs a working way to send the email: with no email
 * provider configured the link could never reach anyone, so accounts are then verified at sign-up instead (and a warning is printed).
 * (A mutable object so the tests can switch it.)
 */
export const settings = { requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION && emailConfigured };
