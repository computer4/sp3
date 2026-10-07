import { env, isProd, isTest } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { deliver } from './transport.js';
import * as templates from './templates.js';
import { invoiceMail, invoiceForOrder, invoiceForUpgrade } from './invoice.js';

/**
 * Sends an email. Never throws: an email failure must not break signup or payment flows.
 * Every attempt is recorded in the EmailLog table (see the admin panel → Emails).
 * Without a provider (development) the email is printed to the console instead.
 */
export async function sendEmail({ to, subject, html, text, replyTo, attachments }) {
  if (!to) return false;
  const result = await deliver({ to, subject, html, text, replyTo, attachments });
  if (result.printed && !isTest) console.log(`\n[email:dev] To: ${to}\n[email:dev] Subject: ${subject}\n${text}\n`);
  return result.ok || (result.printed && !isProd); // without a provider, only development "delivers" (to the console)
}

// Fire-and-forget helpers — callers don't wait for the mail provider.
const fire = (promise) => void promise.catch(() => {});

/** Addresses of the staff accounts with a role (the main admin / the payments admin) plus the studio's notify address. */
async function staffEmails(role) {
  const rows = await prisma.user.findMany({ where: { role, status: 'ACTIVE' }, select: { email: true } }).catch(() => []);
  return [...new Set([...rows.map((r) => r.email), env.ADMIN_NOTIFY_EMAIL].filter(Boolean))];
}
const tellStaff = (role, build) =>
  fire(staffEmails(role).then((list) => Promise.all(list.map((to) => sendEmail({ to, ...build() })))));

export const emails = {
  /** Returns a promise of whether the mail went out — sign-up waits for it so it can tell the client if it didn't. */
  verifyEmail: (user, url) => sendEmail({ to: user.email, ...templates.verifyEmail(user, url) }),
  passwordReset: (user, resetUrl) => fire(sendEmail({ to: user.email, ...templates.passwordReset(user, resetUrl) })),
  teamReply: (to, data) => fire(sendEmail({ to, replyTo: env.ADMIN_NOTIFY_EMAIL, ...templates.teamReply(data) })),
  /** A client sent a payment screenshot → the payments admin (who confirms payments) and the studio inbox. */
  upgradeSubmitted: (data) => tellStaff('PAYMENTS', () => ({ replyTo: data.user.email, ...templates.adminUpgradeSubmitted(data) })),
  paymentSubmitted: (order) => tellStaff('PAYMENTS', () => ({ replyTo: order.user.email, ...templates.adminPaymentSubmitted(order) })),
  /** The payments admin rejected a payment / upgrade payment → tell the client why (and how to try again). */
  paymentRejected: (data) => fire(sendEmail({ to: data.user.email, ...templates.paymentRejected(data) })),
  /** The admin confirmed an upgrade payment → invoice for the difference. */
  upgradeConfirmed: (data) => {
    fire(sendEmail({ to: data.user.email, ...invoiceMail(invoiceForUpgrade({ user: data.user, upgrade: data.upgrade, fromName: data.from, toName: data.to, discountPercent: data.order?.discountPercent ?? 0 })) }));
    tellStaff('ADMIN', () => templates.adminUpgradeConfirmed(data)); // the studio inbox gets the upgrade details too
  },
  /** Someone used a client's referral code and paid, so tell the client they earned a reward. */
  referralReward: (data) => fire(sendEmail({ to: data.referrer.email, ...templates.referralReward(data) })),
  /** A client changed their password → a security notice to the client, and a heads-up to the main admin. */
  passwordChanged: (user) => {
    fire(sendEmail({ to: user.email, ...templates.passwordChanged(user) }));
    tellStaff('ADMIN', () => ({ replyTo: user.email, ...templates.adminPasswordChanged(user) }));
  },
  /** The payment was confirmed → the client gets the invoice; the staff get the usual new-order notice. */
  paymentConfirmed: (order) => {
    fire(sendEmail({ to: order.user.email, ...invoiceMail(invoiceForOrder(order)) }));
    tellStaff('ADMIN', () => templates.adminNewOrder(order));
  },
};
