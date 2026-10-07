import { describe, it, expect } from 'vitest';
import { parseProofImage } from '../src/lib/proof.js';
import { normalizeMobile, signupSchema } from '../src/validation/auth.js';
import { invoiceNumber, invoiceDocument, invoiceMail, invoiceForOrder, invoiceForUpgrade } from '../src/services/email/invoice.js';
import * as templates from '../src/services/email/templates.js';
import { parseFrom } from '../src/services/email/transport.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('payment screenshot check', () => {
  it('accepts a real PNG', () => expect(parseProofImage(PNG)?.mime).toBe('image/png'));
  it('rejects wrong labels, fake bytes, SVG and junk', () => {
    expect(parseProofImage(PNG.replace('image/png', 'image/jpeg'))).toBeNull(); // PNG bytes labelled as JPEG
    expect(parseProofImage('data:image/png;base64,' + Buffer.from('not an image at all').toString('base64'))).toBeNull();
    expect(parseProofImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBeNull();
    expect(parseProofImage('hello')).toBeNull();
    expect(parseProofImage(undefined)).toBeNull();
  });
});

describe('signup validation', () => {
  const valid = { name: 'Artist', email: 'A@Example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '98765 43210' };

  it('normalises mobile numbers', () => {
    expect(normalizeMobile('98765 43210')).toBe('+919876543210');
    expect(normalizeMobile('+91-98765-43210')).toBe('+919876543210');
    expect(normalizeMobile('09876543210')).toBe('+919876543210');
    expect(normalizeMobile('+14155552671')).toBe('+14155552671');
    expect(normalizeMobile('12345')).toBeNull();
    expect(normalizeMobile('abcdefghij')).toBeNull();
  });
  it('accepts valid input and lowercases email', () => {
    const r = signupSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data.email).toBe('a@example.com');
  });
  it('rejects mismatched passwords', () => {
    const r = signupSchema.safeParse({ ...valid, confirmPassword: 'secret124' });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(['confirmPassword']);
  });
  it('rejects weak passwords, bad emails and empty names', () => {
    expect(signupSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});
describe('signup validation', () => {
  const valid = { name: 'Artist', email: 'A@Example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '98765 43210' };

  it('normalises mobile numbers', () => {
    expect(normalizeMobile('98765 43210')).toBe('+919876543210');
    expect(normalizeMobile('+91-98765-43210')).toBe('+919876543210');
    expect(normalizeMobile('09876543210')).toBe('+919876543210');
    expect(normalizeMobile('+14155552671')).toBe('+14155552671');
    expect(normalizeMobile('12345')).toBeNull();
    expect(normalizeMobile('abcdefghij')).toBeNull();
  });
  it('accepts valid input and lowercases email', () => {
    const r = signupSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data.email).toBe('a@example.com');
  });
  it('rejects mismatched passwords', () => {
    const r = signupSchema.safeParse({ ...valid, confirmPassword: 'secret124' });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(['confirmPassword']);
  });
  it('rejects weak passwords, bad emails and empty names', () => {
    expect(signupSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});

describe('invoice', () => {
  const order = {
    id: 'cmuvj5tfp0004eqoc622zwfto', amount: 849, user: { name: 'Asha <b>Rao</b>', email: 'asha@example.com', mobile: '+919876543210' }, plan: { name: 'The Studio', features: JSON.stringify(['Full Master Music Production', 'Melody & Song Composition']) },
    payment: { id: 'pay_abc123', amount: 849, reference: 'UTR 4455', reviewedAt: new Date('2026-10-06T10:00:00Z') },
  };

  it('numbers an invoice from the confirmation date and the order id', () => {
    expect(invoiceNumber(new Date(2026, 9, 6), 'abc123def456')).toBe('INV-20261006-DEF456');
  });

  it('contains the client, plan, amount, PAID stamp and transaction id — and escapes HTML', () => {
    const inv = invoiceForOrder(order);
    const html = invoiceDocument(inv);
    // everything the flowchart lists: branding, client name + email, invoice/order number, plan details, amount, date + status, transaction/payment id, contact
    for (const s of ['STAR PRODUCTION', 'Asha', 'asha@example.com', inv.number, order.id, 'The Studio', 'Full Master Music Production', 'Melody &amp; Song Composition', '₹849', 'Paid', 'PAID', 'October 2026', 'UTR 4455', 'pay_abc123', 'starprod.in@gmail.com']) expect(html).toContain(s);
    expect(html).not.toContain('<b>Rao</b>');
    expect(html).toContain('&lt;b&gt;Rao&lt;/b&gt;');
  });

  it('is emailed with the invoice attached as a file', () => {
    const mail = invoiceMail(invoiceForOrder(order));
    expect(mail.subject).toMatch(/^Invoice INV-\d{8}-[A-Z0-9]{6} — payment confirmed \(₹849\)$/);
    expect(mail.attachments[0].filename).toMatch(/^Invoice-INV-.*\.html$/);
    expect(mail.attachments[0].content).toBe(mail.html);
    expect(mail.text).toContain('Total paid: ₹849');
  });

  it('upgrade invoices show the plan change and the difference', () => {
    const inv = invoiceForUpgrade({ user: order.user, upgrade: { id: 'upg111222333', orderId: 'o1', amount: 300, reference: null, reviewedAt: new Date('2026-10-06T10:00:00Z') }, fromName: 'The Creator', toName: 'The Studio' });
    const html = invoiceDocument(inv);
    expect(html).toContain('Plan upgrade: The Creator → The Studio');
    expect(html).toContain('₹300');
  });
});

describe('verification email', () => {
  it('has the link, the 48-hour note and a text version', () => {
    const m = templates.verifyEmail({ name: 'Asha' }, 'https://example.com/verify.html?token=abc');
    expect(m.subject).toMatch(/Verify your email/);
    expect(m.text).toContain('https://example.com/verify.html?token=abc');
    expect(m.html).toContain('VERIFY MY EMAIL');
    expect(m.html).toContain('48 hours');
  });
});

describe('email sender address (for the Brevo API)', () => {
  it('splits "Name <address>" and accepts a bare address', () => {
    expect(parseFrom('STAR PRODUCTION <starprod.in@gmail.com>')).toEqual({ name: 'STAR PRODUCTION', email: 'starprod.in@gmail.com' });
    expect(parseFrom('"Studio, Inc." <hi@example.com>')).toEqual({ name: 'Studio, Inc.', email: 'hi@example.com' });
    expect(parseFrom('plain@example.com').email).toBe('plain@example.com');
  });
});

describe('payment rejected email', () => {
  it('tells the client why, that no invoice was issued, and how to pay again', () => {
    const m = templates.paymentRejected({ user: { name: 'Asha' }, label: 'The Studio', amount: 849, reason: 'Amount does not match', payUrl: 'https://example.com/pay.html?order_id=o1' });
    expect(m.subject).toMatch(/wasn't accepted/);
    expect(m.text).toContain('Amount does not match');
    expect(m.text).toMatch(/No invoice was issued/);
    expect(m.html).toContain('https://example.com/pay.html?order_id=o1');
  });
});