// Delivers one email. Two ways out — Brevo's HTTPS API (works on every host) or SMTP (Gmail etc.; some hosts block the ports) —
// and every attempt is written to the EmailLog table so a problem shows up in the admin panel.
import nodemailer from 'nodemailer';
import { env, emailProvider, emailConfigured } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

let smtp = null;
function smtpTransport() {
  if (!smtp) {
    smtp = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.EMAIL_API_KEY } : undefined,
      // Fail fast (and visibly) instead of hanging when a host blocks the SMTP port.
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 25_000,
    });
  }
  return smtp;
}

/** "STAR PRODUCTION <starprod.in@gmail.com>" → { name, email } */
export function parseFrom(from) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from ?? '');
  return m ? { name: m[1].trim() || 'STAR PRODUCTION', email: m[2].trim() } : { name: 'STAR PRODUCTION', email: String(from ?? '').trim() };
}

async function viaBrevo({ to, subject, html, text, replyTo, attachments }) {
  const sender = parseFrom(env.EMAIL_FROM);
  const body = {
    sender,
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
    ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    ...(attachments?.length ? { attachment: attachments.map((a) => ({ name: a.filename, content: Buffer.from(a.content).toString('base64') })) } : {}),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(`Brevo ${res.status}: ${detail?.message ?? res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function record(entry) {
  try {
    await prisma.emailLog.create({ data: entry });
    // keep the log small: drop everything but the newest ~500 now and then
    if (Math.random() < 0.05) {
      const old = await prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, skip: 500, select: { id: true } });
      if (old.length) await prisma.emailLog.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
  } catch {
    /* logging must never break an email */
  }
}

/** Sends (or, without a provider, prints) one email. Returns { ok, provider, error }. Never throws. */
export async function deliver(mail) {
  const base = { to: mail.to, subject: String(mail.subject ?? '').slice(0, 200) };
  if (!emailConfigured) {
    await record({ ...base, status: 'SENT', provider: 'console', error: 'No email provider configured — printed to the server console only.' });
    return { ok: false, provider: 'console', error: 'No email provider is configured (set SMTP_HOST or BREVO_API_KEY).', printed: true };
  }
  try {
    if (emailProvider === 'brevo') await viaBrevo(mail);
    else await smtpTransport().sendMail({ from: env.EMAIL_FROM, ...mail });
    await record({ ...base, status: 'SENT', provider: emailProvider });
    return { ok: true, provider: emailProvider };
  } catch (err) {
    const error = String(err?.message ?? err).slice(0, 300);
    console.error(`[email] Failed to send "${base.subject}" to ${mail.to} via ${emailProvider}:`, error);
    await record({ ...base, status: 'FAILED', provider: emailProvider, error });
    return { ok: false, provider: emailProvider, error };
  }
}

/** Checks the SMTP login at startup so a wrong App Password is noticed immediately. */
export async function checkEmailSetup() {
  if (emailProvider === 'brevo') return env.BREVO_API_KEY ? { ok: true, provider: 'brevo' } : { ok: false, provider: 'brevo', error: 'BREVO_API_KEY is empty' };
  if (emailProvider === 'smtp' && env.SMTP_HOST) {
    try {
      await smtpTransport().verify();
      return { ok: true, provider: 'smtp' };
    } catch (err) {
      return { ok: false, provider: 'smtp', error: String(err?.message ?? err) };
    }
  }
  return { ok: false, provider: 'console', error: 'No email provider configured' };
}
