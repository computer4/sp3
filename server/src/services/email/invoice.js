// Invoices: built when the admin confirms a payment, emailed to the client (in the message and as a printable .html attachment).
import { env } from '../../config/env.js';

const ACCENT = '#1f86ab';
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const longDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

const SELLER = { name: 'STAR PRODUCTION', email: 'starprod.in@gmail.com', tagline: 'From the first idea to the final release.' };

/** INV-20261006-3F9A2C — the date the payment was confirmed + the last 6 characters of the order / upgrade id. */
export function invoiceNumber(date, id) {
  const d = new Date(date);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `INV-${ymd}-${String(id).slice(-6).toUpperCase()}`;
}

/** A discount row for the invoice: "NEW-STAR (15% off)" and the rupees taken off. Null when there is none. */
function discountLine(percent, code, amount) {
  if (!percent || !(amount > 0)) return null;
  const name = code === 'REWARD' ? 'Referral reward' : code || 'Discount';
  return { label: `${name} (${percent}% off)`, amount };
}

/** The plan's included services (stored as a JSON list in the database). */
function planFeatures(plan) {
  try {
    const list = typeof plan?.features === 'string' ? JSON.parse(plan.features) : plan?.features;
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

/** Invoice for a plan payment. `order` includes user, plan and payment (the confirmed one). */
export function invoiceForOrder(order) {
  const date = order.payment?.reviewedAt ?? new Date();
  const paid = order.payment?.amount ?? order.amount;
  const listed = order.discountPercent && order.plan?.price > paid ? order.plan.price : paid; // the price before the discount
  return {
    number: invoiceNumber(date, order.id),
    date,
    client: { name: order.user.name, email: order.user.email, mobile: order.user.mobile },
    items: [{ description: order.plan.name, detail: 'Music production plan (per song)', features: planFeatures(order.plan), amount: listed }],
    discount: discountLine(order.discountPercent, order.discountCode, listed - paid),
    method: 'UPI QR',
    reference: order.payment?.reference ?? null,
    paymentId: order.payment?.id ?? null,
    orderId: order.id,
  };
}

/** Invoice for an upgrade payment (the difference between two plans). */
export function invoiceForUpgrade({ user, upgrade, fromName, toName, discountPercent = 0 }) {
  const date = upgrade.reviewedAt ?? new Date();
  return {
    number: invoiceNumber(date, upgrade.id),
    date,
    client: { name: user.name, email: user.email, mobile: user.mobile },
    items: [{ description: `Plan upgrade: ${fromName} → ${toName}`, detail: discountPercent ? `Difference between the two plans (your ${discountPercent}% discount is included)` : 'Difference between the two plans', amount: upgrade.amount }],
    method: 'UPI QR',
    reference: upgrade.reference ?? null,
    paymentId: upgrade.id,
    orderId: upgrade.orderId,
  };
}

export const invoiceTotal = (inv) => inv.items.reduce((s, i) => s + i.amount, 0) - (inv.discount?.amount ?? 0);

/** A complete, print-friendly HTML document (also used as the email body). */
export function invoiceDocument(inv) {
  const total = invoiceTotal(inv);
  const rows = inv.items
    .map(
      (i) => `<tr><td style="padding:14px 0;border-bottom:1px solid #e6e8ec"><b style="color:#0c090d">${esc(i.description)}</b><br><span style="color:#6b7280;font-size:12px">${esc(i.detail ?? '')}</span>${i.features?.length ? `<div style="margin-top:8px;font-size:12px;color:#4b5563;line-height:1.6"><b style="color:#0c090d">Includes</b><br>${i.features.map((f) => `• ${esc(f)}`).join('<br>')}</div>` : ''}</td>
<td style="padding:14px 0;border-bottom:1px solid #e6e8ec;text-align:right;white-space:nowrap">${rupees(i.amount)}</td></tr>`,
    )
    .join('');
  const meta = (k, v) => `<tr><td style="padding:3px 16px 3px 0;color:#6b7280">${esc(k)}</td><td style="padding:3px 0;color:#0c090d">${esc(v)}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(inv.number)} — STAR PRODUCTION</title>
<style>@media print{body{background:#fff!important}.sheet{box-shadow:none!important;border:0!important}}</style></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" class="sheet" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e6e8ec;box-shadow:0 8px 30px rgba(0,0,0,.06)">
<tr><td style="padding:28px 32px;border-bottom:4px solid ${ACCENT}">
  <table role="presentation" width="100%"><tr>
    <td><div style="font-size:18px;font-weight:bold;letter-spacing:4px;color:#0c090d">STAR PRODUCTION</div><div style="margin-top:4px;font-size:12px;color:#6b7280">${esc(SELLER.tagline)}</div></td>
    <td align="right"><div style="font-size:12px;letter-spacing:3px;color:#6b7280">INVOICE</div><div style="margin-top:4px;font-size:16px;font-weight:bold;color:#0c090d">${esc(inv.number)}</div></td>
  </tr></table>
</td></tr>
<tr><td style="padding:24px 32px 8px">
  <table role="presentation" width="100%" style="font-size:13px"><tr>
    <td valign="top" style="width:55%"><div style="font-size:11px;letter-spacing:2px;color:#6b7280">BILLED TO</div>
      <div style="margin-top:6px;font-size:15px;font-weight:bold;color:#0c090d">${esc(inv.client.name)}</div>
      <div style="color:#4b5563">${esc(inv.client.email)}</div>${inv.client.mobile ? `<div style="color:#4b5563">${esc(inv.client.mobile)}</div>` : ''}</td>
    <td valign="top"><table role="presentation" style="font-size:13px">${meta('Date', longDate(inv.date))}${meta('Status', 'Paid')}${meta('Payment', inv.method)}${inv.reference ? meta('Transaction ID', inv.reference) : ''}${inv.paymentId ? meta('Payment ID', inv.paymentId) : ''}${meta('Order no.', inv.orderId)}</table></td>
  </tr></table>
</td></tr>
<tr><td style="padding:12px 32px 0">
  <table role="presentation" width="100%" style="font-size:14px"><tr><td style="padding:10px 0;border-bottom:2px solid #0c090d;font-size:11px;letter-spacing:2px;color:#6b7280">DESCRIPTION</td><td style="padding:10px 0;border-bottom:2px solid #0c090d;font-size:11px;letter-spacing:2px;color:#6b7280;text-align:right">AMOUNT</td></tr>${rows}
  ${inv.discount ? `<tr><td style="padding:12px 0 0;text-align:right;color:#16a34a">Discount — ${esc(inv.discount.label)}</td><td style="padding:12px 0 0;text-align:right;color:#16a34a;white-space:nowrap">− ${rupees(inv.discount.amount)}</td></tr>` : ''}
  <tr><td style="padding:16px 0;text-align:right;color:#6b7280">Total paid</td><td style="padding:16px 0;text-align:right;font-size:20px;font-weight:bold;color:#0c090d;white-space:nowrap">${rupees(total)}</td></tr></table>
</td></tr>
<tr><td style="padding:4px 32px 28px"><span style="display:inline-block;padding:6px 16px;border:2px solid #16a34a;color:#16a34a;font-weight:bold;letter-spacing:3px;font-size:13px">PAID</span>
  <span style="margin-left:10px;font-size:12px;color:#6b7280">Payment received and confirmed by STAR PRODUCTION.</span></td></tr>
<tr><td style="padding:18px 32px;background:#f9fafb;border-top:1px solid #e6e8ec;font-size:12px;color:#6b7280">
  Thank you for choosing STAR PRODUCTION. Questions about this invoice? Write to <a href="mailto:${esc(SELLER.email)}" style="color:${ACCENT}">${esc(SELLER.email)}</a>.<br>
  <b>Next step:</b> please email your project details (song title, genre, references, lyrics or demo, deadline) to <a href="mailto:${esc(SELLER.email)}" style="color:${ACCENT}">${esc(SELLER.email)}</a> and mention your order no. ${esc(inv.orderId)}.<br>This is a computer-generated invoice and needs no signature. Follow your project on your <a href="${esc(env.APP_URL)}/dashboard.html" style="color:${ACCENT}">dashboard</a>.
</td></tr>
</table></td></tr></table></body></html>`;
}

/** The email itself: subject, plain text, the invoice as the body, and the same invoice as a downloadable file. */
export function invoiceMail(inv) {
  const total = invoiceTotal(inv);
  const lines = inv.items
    .map((i) => `  • ${i.description} — ${rupees(i.amount)}${i.features?.length ? `\n      Includes: ${i.features.join('; ')}` : ''}`)
    .join('\n');
  return {
    subject: `Invoice ${inv.number} — payment confirmed (${rupees(total)})`,
    text: `Hi ${inv.client.name},\n\nWe've confirmed your payment. Here is your invoice.\n\nInvoice: ${inv.number}\nOrder no.: ${inv.orderId}\nDate: ${longDate(inv.date)}\nBilled to: ${inv.client.name} <${inv.client.email}>\n${lines}${inv.discount ? `\nDiscount: ${inv.discount.label} - ${rupees(inv.discount.amount)}` : ''}\nTotal paid: ${rupees(total)}\nStatus: Paid${inv.reference ? `\nTransaction ID: ${inv.reference}` : ''}${inv.paymentId ? `\nPayment ID: ${inv.paymentId}` : ''}\nContact: ${SELLER.email}\n\n\nNEXT STEP: please email your project details (song title, genre, references, lyrics or demo, deadline) to ${SELLER.email} and mention order no. ${inv.orderId}.\n\nThe invoice is also attached as a file you can open and print.\nDashboard: ${env.APP_URL}/dashboard.html\n\n— STAR PRODUCTION`,
    html: invoiceDocument(inv),
    attachments: [{ filename: `Invoice-${inv.number}.html`, content: invoiceDocument(inv), contentType: 'text/html; charset=utf-8' }],
  };
}
