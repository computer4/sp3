import { env } from '../../config/env.js';
import { invoiceNumber } from './invoice.js';

const INK = '#0C090D';
const ACCENT = '#33aed6';
const LIGHT = '#EBEBEB';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const rupees = (amount) => `₹${Number(amount).toLocaleString('en-IN')}`;

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:${INK};font-family:Arial,Helvetica,sans-serif;color:${LIGHT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK};padding:32px 16px">
<tr><td align="center"><table role="presentation" width="100%" style="max-width:560px;border:1px solid rgba(235,235,235,.12)">
<tr><td style="padding:28px 32px;border-bottom:1px solid rgba(235,235,235,.12)">
<span style="font-size:13px;letter-spacing:4px;font-weight:bold;color:${LIGHT}">STAR PRODUCTION</span></td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:22px;color:${LIGHT}">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.6;color:${LIGHT}">${bodyHtml}</div></td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid rgba(235,235,235,.12);font-size:12px;color:rgba(235,235,235,.55)">
From the first idea to the final release.</td></tr></table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:28px 0"><a href="${esc(href)}" style="background:${ACCENT};color:${LIGHT};text-decoration:none;padding:12px 22px;font-weight:bold;letter-spacing:1px;font-size:13px">${esc(label)}</a></p>`;

const row = (k, v) =>
  `<tr><td style="padding:6px 0;color:rgba(235,235,235,.6)">${esc(k)}</td><td style="padding:6px 0;text-align:right">${esc(v)}</td></tr>`;

function orderTable(order) {
  const payment = order.payment;
  return `<table role="presentation" width="100%" style="font-size:14px;border-top:1px solid rgba(235,235,235,.12);margin-top:16px">
${row('Plan', order.plan.name)}${row('Amount', rupees(order.amount))}
${payment?.reference ? row('Transaction ID', payment.reference) : ''}${row('Order ID', order.id)}
${row('Order status', 'Paid')}</table>`;
}

export function verifyEmail(user, verifyUrl) {
  return {
    subject: 'Verify your email — STAR PRODUCTION',
    text: `Hi ${user.name},\n\nWelcome to STAR PRODUCTION! Please confirm this email address by opening the link below (valid for 48 hours):\n${verifyUrl}\n\nYou'll need a verified email before you can pay for a plan, and we send your invoice here.\nIf you didn't create this account, you can ignore this message.\n\n— STAR PRODUCTION`,
    html: layout(
      `Welcome, ${user.name}`,
      `<p>Thanks for joining STAR PRODUCTION. Please confirm that this is your email address — it takes one click.</p>${button(verifyUrl, 'VERIFY MY EMAIL')}` +
        `<p style="color:rgba(235,235,235,.6);font-size:13px">The link is valid for 48 hours. You'll need a verified email before you can pay for a plan, and your invoice is sent here.<br>If you didn't create this account, you can ignore this email.</p>` +
        `<p style="color:rgba(235,235,235,.45);font-size:12px;word-break:break-all">Button not working? Copy this link into your browser:<br>${esc(verifyUrl)}</p>`,
    ),
  };
}
export function passwordReset(user, resetUrl) {
  return {
    subject: 'Reset your STAR PRODUCTION password',
    text: `Hi ${user.name},\n\nUse this link to reset your password (valid for 1 hour): ${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: layout(
      'Reset your password',
      `<p>We received a request to reset your password. This link is valid for 1 hour.</p>${button(resetUrl, 'RESET PASSWORD')}<p style="color:rgba(235,235,235,.6);font-size:13px">If you didn't request this, you can safely ignore this email.</p>`,
    ),
  };
}

export function paymentRejected({ user, label, amount, reason, payUrl }) {
  return {
    subject: `Your payment wasn't accepted — ${label}`,
    text: `Hi ${user.name},\n\nWe couldn't accept your payment of ${rupees(amount)} for ${label}.\nReason: ${reason}\n\nNo invoice was issued and your order is unchanged. Please pay again and send a clear screenshot:\n${payUrl}\n\nNeed help? Write to ${env.ADMIN_NOTIFY_EMAIL ?? 'starprod.in@gmail.com'}.\n\n— STAR PRODUCTION`,
    html: layout(
      'Your payment wasn’t accepted',
      `<p>Hi ${esc(user.name)}, we couldn't accept your payment of <b>${esc(rupees(amount))}</b> for <b>${esc(label)}</b>.</p>` +
        `<p style="border-left:3px solid #ff6b6b;padding:4px 0 4px 14px;margin:16px 0"><b>Reason:</b> ${esc(reason)}</p>` +
        `<p style="color:rgba(235,235,235,.65);font-size:14px">No invoice was issued and your order is unchanged. Please pay again and attach a clear screenshot.</p>${button(payUrl, 'PAY AGAIN')}`,
    ),
  };
}
export function teamReply({ name, message, registered }) {
  const url = `${env.APP_URL}/#/dashboard`;
  return {
    subject: 'A reply from STAR PRODUCTION',
    text: `Hi ${name || 'there'},\n\nOur team replied to your question:\n\n${message}\n\n${registered ? `You can also see this in your dashboard: ${url}\n\n` : 'Just reply to this email if you have more questions.\n\n'}— STAR PRODUCTION`,
    html: layout(
      'We replied to your question',
      `<p>Hi ${esc(name || 'there')}, our team replied:</p><p style="white-space:pre-wrap;border-left:3px solid ${ACCENT};padding:4px 0 4px 14px;margin:16px 0">${esc(message)}</p>` +
        (registered ? button(url, 'OPEN DASHBOARD') : '<p style="color:rgba(235,235,235,.6);font-size:13px">Just reply to this email if you have more questions.</p>'),
    ),
  };
}

export function adminPaymentSubmitted(order) {
  const url = `${env.APP_URL}/admin.html`;
  return {
    subject: `Payment to verify — ${rupees(order.amount)} — ${order.user.name}`,
    text: `${order.user.name} (${order.user.email}) sent a payment screenshot for ${order.plan.name} (${rupees(order.amount)}).\n\nVerify it in the admin panel: ${url}`,
    html: layout('Payment waiting for verification', `<p>${esc(order.user.name)} sent a payment screenshot.</p>${orderTable(order)}${button(url, 'VERIFY PAYMENT')}`),
  };
}

export function adminUpgradeSubmitted({ user, amount, from, to }) {
  const url = `${env.APP_URL}/admin.html`;
  return {
    subject: `Upgrade payment to verify — ${rupees(amount)} — ${user.name}`,
    text: `${user.name} (${user.email}) sent a payment screenshot for an upgrade: ${from} → ${to} (${rupees(amount)}).\n\nVerify it in the admin panel: ${url}`,
    html: layout('Upgrade payment waiting for verification', `<p>${esc(user.name)} sent a payment screenshot for an upgrade.</p><table role="presentation" width="100%" style="font-size:14px;border-top:1px solid rgba(235,235,235,.12);margin-top:16px">${row('Upgrade', `${from} → ${to}`)}${row('Amount', rupees(amount))}${row('Email', user.email)}</table>${button(url, 'VERIFY PAYMENT')}`),
  };
}

export function referralReward({ referrer, friend, percent }) {
  const url = `${env.APP_URL}/dashboard.html`;
  return {
    subject: `You earned ${percent}% off — ${friend.name} joined with your code`,
    text: `Hi ${referrer.name},\n\n${friend.name} used your referral code and their payment is confirmed. Thank you for sharing STAR PRODUCTION!\n\nYour reward: ${percent}% off your next plan. It is applied automatically when you take your next plan (no code needed).\n\nDashboard: ${url}\n\n? STAR PRODUCTION`,
    html: layout('You earned a reward', `<p>Hi ${esc(referrer.name)},</p><p><b>${esc(friend.name)}</b> used your referral code and their payment is confirmed. Thank you for sharing STAR PRODUCTION!</p><p style="font-size:18px;color:${ACCENT}"><b>${percent}% off your next plan</b></p><p style="color:rgba(235,235,235,.6);font-size:13px">It is applied automatically when you take your next plan — no code needed.</p>${button(url, 'OPEN DASHBOARD')}`),
  };
}

export function passwordChanged(user) {
  return {
    subject: 'Your STAR PRODUCTION password was changed',
    text: `Hi ${user.name},\n\nYour account password was just changed. If this was you, no action is needed.\nIf it wasn't, contact us right away at ${env.ADMIN_NOTIFY_EMAIL ?? 'starprod.in@gmail.com'}.\n\n— STAR PRODUCTION`,
    html: layout('Password changed', `<p>Hi ${esc(user.name)}, your account password was just changed.</p><p style="color:rgba(235,235,235,.6);font-size:13px">If this was you, no action is needed. If it wasn't, contact us right away.</p>`),
  };
}

export function adminPasswordChanged(user) {
  return {
    subject: `Client changed their password — ${user.name}`,
    text: `${user.name} <${user.email}> changed their account password.\nIf this looks wrong, open the admin panel and set a new password or block the account.`,
    html: layout('A client changed their password', `<table role="presentation" width="100%" style="font-size:14px">${row('Client', user.name)}${row('Email', user.email)}</table><p style="color:rgba(235,235,235,.6);font-size:13px">If this looks wrong, set a new password or block the account in the admin panel.</p>${button(`${env.APP_URL}/admin.html`, 'OPEN ADMIN')}`),
  };
}

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' IST' : '-');
const featuresOf = (plan) => {
  try { const l = typeof plan?.features === 'string' ? JSON.parse(plan.features) : plan?.features; return Array.isArray(l) ? l.map(String) : []; } catch { return []; }
};
const section = (title, rowsHtml) =>
  `<p style="margin:24px 0 4px;font-size:11px;letter-spacing:2px;color:${ACCENT}">${esc(title)}</p><table role="presentation" width="100%" style="font-size:14px;border-top:1px solid rgba(235,235,235,.12)">${rowsHtml}</table>`;
const line = (k, v) => `${k}: ${v}`;

/**
 * Sent automatically to the studio inbox (ADMIN_NOTIFY_EMAIL, starprod.in@gmail.com) the moment a payment is confirmed:
 * everything needed to start the project — client, plan and what it includes, payment, and where the project stands.
 */
export function adminNewOrder(order) {
  const { user, plan, payment } = order;
  const features = featuresOf(plan);
  const paidAt = payment?.reviewedAt ?? new Date();
  const invoiceNo = invoiceNumber(paidAt, order.id);
  const adminUrl = `${env.APP_URL}/admin.html`;
  const text = [
    'NEW PROJECT — PAYMENT CONFIRMED', '',
    'CLIENT', line('Name', user.name), line('Email', user.email), line('Mobile', user.mobile || '-'), line('Client since', when(user.createdAt)), '',
    'PLAN', line('Plan', plan.name), line('Price', rupees(plan.price ?? order.amount)), ...(order.discountPercent ? [line('Discount', `${order.discountCode === 'REWARD' ? 'Referral reward' : order.discountCode} (${order.discountPercent}% off)`)] : []), line('Final output', plan.finalOutput || '-'),
    'Includes:', ...(features.length ? features.map((f) => '  - ' + f) : ['  -']), '',
    'PAYMENT', line('Amount paid', rupees(payment?.amount ?? order.amount)), line('Method', 'UPI QR'), line('Transaction ID', payment?.reference || '-'),
    line('Screenshot sent', when(payment?.submittedAt)), line('Confirmed', when(paidAt)), line('Invoice no.', invoiceNo), '',
    'PROJECT', line('Order ID', order.id), line('Order created', when(order.createdAt)), line('Project stage', String(order.stage).replace(/_/g, ' ')), line('Work status', order.workState), '',
    'Next step: open the admin panel, move the project to "In process" and contact the client.', adminUrl,
  ].join('\n');
  const html = layout(
    'New project — payment confirmed',
    `<p style="margin:0 0 4px">${esc(user.name)} bought <b>${esc(plan.name)}</b> (${rupees(payment?.amount ?? order.amount)}). The invoice has been sent to the client.</p>` +
      section('CLIENT', row('Name', user.name) + row('Email', user.email) + row('Mobile', user.mobile || '-') + row('Client since', when(user.createdAt))) +
      section('PLAN', row('Plan', plan.name) + row('Price', rupees(plan.price ?? order.amount)) + (order.discountPercent ? row('Discount', `${order.discountCode === 'REWARD' ? 'Referral reward' : order.discountCode} (${order.discountPercent}% off)`) : '') + row('Final output', plan.finalOutput || '-')) +
      (features.length ? `<p style="margin:12px 0 0;font-size:13px;color:rgba(235,235,235,.75);line-height:1.7"><b>Includes</b><br>${features.map((f) => '• ' + esc(f)).join('<br>')}</p>` : '') +
      section('PAYMENT', row('Amount paid', rupees(payment?.amount ?? order.amount)) + row('Method', 'UPI QR') + row('Transaction ID', payment?.reference || '-') + row('Screenshot sent', when(payment?.submittedAt)) + row('Confirmed', when(paidAt)) + row('Invoice no.', invoiceNo)) +
      section('PROJECT', row('Order ID', order.id) + row('Order created', when(order.createdAt)) + row('Project stage', String(order.stage).replace(/_/g, ' ')) + row('Work status', order.workState)) +
      `<p style="margin:20px 0 0;color:rgba(235,235,235,.6);font-size:13px">Next step: move the project to "In process" and contact the client.</p>${button(adminUrl, 'OPEN ADMIN')}`,
  );
  return { subject: `New project — ${plan.name} — ${user.name} — ${rupees(payment?.amount ?? order.amount)}`, text, html };
}

/** A confirmed plan upgrade changes what the client gets — the studio inbox is told what to deliver now. */
export function adminUpgradeConfirmed({ user, order, upgrade, from, to, toPlan }) {
  const features = featuresOf(toPlan);
  const adminUrl = `${env.APP_URL}/admin.html`;
  const text = [
    'PLAN UPGRADED — PAYMENT CONFIRMED', '',
    line('Client', `${user.name} <${user.email}>`), line('Mobile', user.mobile || '-'),
    line('Upgrade', `${from} → ${to}`), line('Amount paid', rupees(upgrade.amount)), line('Transaction ID', upgrade.reference || '-'), line('Confirmed', when(upgrade.reviewedAt ?? new Date())),
    line('Invoice no.', invoiceNumber(upgrade.reviewedAt ?? new Date(), upgrade.id)), line('Order ID', order?.id ?? upgrade.orderId),
    'New plan includes:', ...(features.length ? features.map((f) => '  - ' + f) : ['  -']), '', adminUrl,
  ].join('\n');
  const html = layout(
    'Plan upgraded — payment confirmed',
    `<p style="margin:0 0 4px">${esc(user.name)} upgraded <b>${esc(from)} → ${esc(to)}</b>.</p>` +
      section('CLIENT', row('Name', user.name) + row('Email', user.email) + row('Mobile', user.mobile || '-')) +
      section('PAYMENT', row('Upgrade', `${from} → ${to}`) + row('Amount paid', rupees(upgrade.amount)) + row('Transaction ID', upgrade.reference || '-') + row('Confirmed', when(upgrade.reviewedAt ?? new Date())) + row('Invoice no.', invoiceNumber(upgrade.reviewedAt ?? new Date(), upgrade.id)) + row('Order ID', order?.id ?? upgrade.orderId)) +
      (features.length ? `<p style="margin:12px 0 0;font-size:13px;color:rgba(235,235,235,.75);line-height:1.7"><b>New plan includes</b><br>${features.map((f) => '• ' + esc(f)).join('<br>')}</p>` : '') + button(adminUrl, 'OPEN ADMIN'),
  );
  return { subject: `Plan upgraded — ${from} → ${to} — ${user.name}`, text, html };
}
