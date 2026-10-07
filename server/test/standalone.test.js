// The standalone engine (assets/standalone.js) must behave like the server. Same flows, in-memory storage.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';

const require = createRequire(import.meta.url);
const SA = require('../../assets/standalone.js');
const plans = require('../../data/plans.js');
const faq = require('../../data/chat/faq.js');

// The two official staff accounts (main admin / payments admin).
const MAIN = { email: 'khyal.music.work@gmail.com', password: 'k123456789' };
const SIDE = { email: 'kaushikaarav80@gmail.com', password: 'a123456789' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function setup() {
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  let changes = 0;
  const engine = SA.createEngine({ storage, plans, faq: () => faq, onChange: () => { changes += 1; } });
  /** One "browser": its own login, talking to the shared engine. */
  const browser = () => {
    const ctx = { session: { userId: null } };
    const call = (method, path, body) => engine.handle(method, path, body ?? null, ctx);
    return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p) };
  };
  return { engine, browser, changes: () => changes };
}

const signupBody = (email) => ({ name: 'Artist A', email, password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210' });

describe('standalone engine', () => {
  let t;
  beforeEach(() => { t = setup(); });

  it('sha256 matches Node crypto (so passwords are hashed correctly)', () => {
    for (const s of ['', 'abc', 'STAR PRODUCTION ₹849 — ünïcode', 'x'.repeat(200)]) {
      expect(SA.sha256(s)).toBe(crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
    }
    const h = SA.hashPassword('secret123', 'abcd');
    expect(SA.verifyPassword(h, 'secret123')).toBe(true);
    expect(SA.verifyPassword(h, 'secret124')).toBe(false);
    expect(h).not.toContain('secret123');
  });

  it('serves the plans', async () => {
    const r = await t.browser().get('/api/plans');
    expect(r.body.plans.map((p) => [p.id, p.price])).toEqual([['foundation', 249], ['creator', 549], ['studio', 849], ['signature', 1499]]);
  });

  it('signup / login messages and rules match the server', async () => {
    const b = t.browser();
    const bad = await b.post('/api/auth/signup', { name: '', email: 'nope', password: 'short', confirmPassword: 'x', mobile: '12' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['confirmPassword', 'email', 'mobile', 'name', 'password']);

    const ok = await b.post('/api/auth/signup', { ...signupBody('A@Example.com'), role: 'ADMIN' });
    expect(ok.status).toBe(201);
    expect(ok.body.user).toMatchObject({ email: 'a@example.com', role: 'CLIENT', mobile: '+919876543210', emailVerified: true });
    expect(JSON.stringify(ok.body)).not.toMatch(/passwordHash|sa\$/);
    expect((await b.get('/api/auth/me')).body.user.email).toBe('a@example.com');

    expect((await t.browser().post('/api/auth/signup', signupBody('a@example.com'))).body.error.message).toBe('This Email is already registered');
    const other = t.browser();
    expect((await other.post('/api/auth/login', { email: 'x@example.com', password: 'secret123' })).body.error.message).toBe("This Email isn't registered");
    expect((await other.post('/api/auth/login', { email: 'a@example.com', password: 'wrongpass1' })).body.error.message).toBe('Password is wrong');
    expect((await other.post('/api/auth/login', { email: 'a@example.com', password: 'secret123' })).status).toBe(200);

    await b.post('/api/auth/logout');
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await b.get('/api/orders')).status).toBe(401);
  });

  it('the two official admins log in; permissions: main admin cannot confirm payments, payments admin cannot open client details', async () => {
    const main = t.browser(); expect((await main.post('/api/auth/login', MAIN)).body.user).toMatchObject({ role: 'ADMIN', email: 'khyal.music.work@gmail.com' });
    const pay = t.browser(); expect((await pay.post('/api/auth/login', SIDE)).body.user).toMatchObject({ role: 'PAYMENTS', email: 'kaushikaarav80@gmail.com' });
    expect((await t.browser().post('/api/auth/login', { email: 'admin@gmail.com', password: 'ADMIN' })).status).toBe(404); // the old default admin no longer exists

    for (const who of [main, pay]) {
      expect((await who.get('/api/admin/stats')).body.stats).toEqual(expect.objectContaining({ totalRevenue: 0, totalClients: 0 }));
      expect((await who.get('/api/admin/orders')).status).toBe(200);
      expect((await who.get('/api/admin/payments')).status).toBe(200);
      expect((await who.get('/api/admin/messages')).status).toBe(200);
    }
    expect((await main.get('/api/admin/clients')).status).toBe(200);
    expect((await pay.get('/api/admin/clients')).status).toBe(403);
    expect((await pay.get('/api/admin/emails')).status).toBe(403);
    expect((await main.get('/api/admin/emails')).status).toBe(200);
    expect((await main.post('/api/admin/payments/x/approve')).status).toBe(403);
    expect((await pay.post('/api/admin/payments/x/approve')).status).toBe(404); // allowed for the payments admin (the payment just doesn't exist)
    expect((await pay.patch('/api/admin/orders/x', { stage: 'COMPLETED' })).status).toBe(403);

    const c = t.browser();
    await c.post('/api/auth/signup', signupBody('c@example.com'));
    expect((await c.get('/api/admin/stats')).status).toBe(403);
    expect((await t.browser().get('/api/admin/stats')).status).toBe(401);
  });
  it('full journey: apply → admin requests payment → QR screenshot → admin confirms → dashboard data', async () => {
    const admin = t.browser(); await admin.post('/api/auth/login', MAIN);
    const payer = t.browser(); await payer.post('/api/auth/login', SIDE);
    const c = t.browser(); await c.post('/api/auth/signup', signupBody('j@example.com'));

    const applied = (await c.post('/api/orders', { planId: 'creator', amount: 1 })).body.order; // a price sent by the browser is ignored
    expect(applied).toMatchObject({ amount: 549, stage: 'APPLIED', workState: 'REVIEW', status: 'PENDING', paymentStatus: 'UNPAID', active: true });
    expect((await c.post('/api/orders', { planId: 'studio' })).body.error.code).toBe('ACTIVE_PLAN_EXISTS');

    // Not yet requested.
    expect((await c.post(`/api/orders/${applied.id}/payment-proof`, { screenshot: PNG })).body.error.code).toBe('PAYMENT_NOT_REQUESTED');
    await admin.patch(`/api/admin/orders/${applied.id}`, { stage: 'PAYMENT_PENDING' });

    // Validation of the screenshot.
    expect((await c.post(`/api/orders/${applied.id}/payment-proof`, {})).status).toBe(400);
    expect((await c.post(`/api/orders/${applied.id}/payment-proof`, { screenshot: 'data:image/png;base64,' + Buffer.from('not an image'.repeat(20)).toString('base64') })).status).toBe(400);
    expect((await c.post(`/api/orders/${applied.id}/payment-proof`, { screenshot: 'data:image/svg+xml;base64,' + 'A'.repeat(200) })).status).toBe(400);

    const sent = await c.post(`/api/orders/${applied.id}/payment-proof`, { screenshot: PNG, reference: 'UTR42' });
    expect(sent.status).toBe(201);
    expect(sent.body.order).toMatchObject({ status: 'PAYMENT_PROCESSING', paymentStatus: 'PENDING' });
    expect((await c.post(`/api/orders/${applied.id}/payment-proof`, { screenshot: PNG })).body.error.code).toBe('ALREADY_SUBMITTED');
    expect((await c.get(`/api/orders/${applied.id}/proof`)).image.mime).toBe('image/png');

    // The admin sees a verification request with the screenshot.
    expect((await admin.get('/api/admin/stats')).body.stats.paymentRequests).toBe(1);
    const pay = (await admin.get('/api/admin/payments')).body.payments[0];
    expect(pay).toMatchObject({ status: 'PENDING', reference: 'UTR42', hasProof: true, order: { plan: 'The Creator', client: { email: 'j@example.com' } } });
    expect((await admin.get(pay.screenshotUrl)).image.dataUrl).toBe(PNG);
    expect((await c.post(`/api/admin/payments/${pay.id}/approve`)).status).toBe(403); // clients can't confirm their own payment

    expect((await payer.post(`/api/admin/payments/${pay.id}/approve`)).status).toBe(200);
    expect((await payer.post(`/api/admin/payments/${pay.id}/approve`)).status).toBe(409);
    const order = (await c.get(`/api/orders/${applied.id}/status`)).body.order;
    expect(order).toMatchObject({ status: 'PAID', paymentStatus: 'SUCCESS', stage: 'INVOICE_ISSUED', paymentIncomplete: false });
    expect((await admin.get('/api/admin/stats')).body.stats).toMatchObject({ paymentRequests: 0, totalRevenue: 549, totalClients: 1 });
  });

  it('rejection shows the reason and the client can pay again', async () => {
    const admin = t.browser(); await admin.post('/api/auth/login', MAIN);
    const payer = t.browser(); await payer.post('/api/auth/login', SIDE);
    const c = t.browser(); await c.post('/api/auth/signup', signupBody('r@example.com'));
    const id = (await c.post('/api/orders', { planId: 'studio' })).body.order.id;
    await admin.patch(`/api/admin/orders/${id}`, { stage: 'PAYMENT_PENDING' });
    await c.post(`/api/orders/${id}/payment-proof`, { screenshot: PNG });
    const pay = (await admin.get('/api/admin/payments')).body.payments[0];
    expect((await payer.post(`/api/admin/payments/${pay.id}/reject`, { reason: '' })).status).toBe(400);
    expect((await payer.post(`/api/admin/payments/${pay.id}/reject`, { reason: 'Amount does not match' })).status).toBe(200);
    const o = (await c.get(`/api/orders/${id}/status`)).body.order;
    expect(o).toMatchObject({ status: 'PENDING', paymentStatus: 'FAILED', paymentIncomplete: true });
    expect(o.payment.note).toBe('Amount does not match');
    expect((await c.post(`/api/orders/${id}/payment-proof`, { screenshot: PNG, reference: 'UTR9' })).status).toBe(201);
    expect((await c.get(`/api/orders/${id}/status`)).body.order.payment).toMatchObject({ status: 'PENDING', note: null, reference: 'UTR9' });
  });

  it('upgrade: unpaid switches at once; paid creates an upgrade payment (QR + screenshot + admin confirm); higher plans only; not after production', async () => {
    const admin = t.browser(); await admin.post('/api/auth/login', MAIN);
    const payer = t.browser(); await payer.post('/api/auth/login', SIDE);
    const c = t.browser(); await c.post('/api/auth/signup', signupBody('u@example.com'));
    const id = (await c.post('/api/orders', { planId: 'foundation' })).body.order.id;
    expect((await c.post(`/api/orders/${id}/upgrade`, { planId: 'foundation' })).status).toBe(400);
    const up = await c.post(`/api/orders/${id}/upgrade`, { planId: 'studio' });
    expect(up.body).toMatchObject({ applied: true, order: { plan: { id: 'studio' }, amount: 849 } });

    await admin.patch(`/api/admin/orders/${id}`, { status: 'PAID' });
    const req = await c.post(`/api/orders/${id}/upgrade`, { planId: 'signature' });
    expect(req.body).toMatchObject({ requested: true, remaining: 650, upgrade: { status: 'CREATED', amount: 650, fromPlanId: 'studio', toPlanId: 'signature' } });
    const uid = req.body.upgrade.id;
    expect((await c.get(`/api/orders/${id}/status`)).body.order).toMatchObject({ plan: { id: 'studio' }, upgrade: { id: uid, status: 'CREATED' } }); // not switched yet

    expect((await c.post(`/api/orders/upgrades/${uid}/payment-proof`, { screenshot: 'nope' })).status).toBe(400);
    expect((await c.post(`/api/orders/upgrades/${uid}/payment-proof`, { screenshot: PNG, reference: 'UP1' })).status).toBe(201);
    expect((await c.post(`/api/orders/upgrades/${uid}/payment-proof`, { screenshot: PNG })).body.error.code).toBe('ALREADY_SUBMITTED');
    expect((await c.post(`/api/orders/${id}/upgrade`, { planId: 'signature' })).body.error.code).toBe('UPGRADE_IN_PROGRESS');
    expect((await c.get(`/api/orders/upgrades/${uid}/proof`)).image.mime).toBe('image/png');

    expect((await admin.get('/api/admin/stats')).body.stats.paymentRequests).toBe(1);
    const row = (await admin.get('/api/admin/payments')).body.payments.find((p) => p.kind === 'UPGRADE');
    expect(row).toMatchObject({ id: uid, status: 'PENDING', amount: 650, reference: 'UP1', hasProof: true, order: { plan: 'Upgrade: The Studio → The Signature' } });
    expect((await admin.get(row.screenshotUrl)).image.dataUrl).toBe(PNG);
    expect((await c.post(`/api/admin/upgrades/${uid}/approve`)).status).toBe(403);

    expect((await payer.post(`/api/admin/upgrades/${uid}/reject`, { reason: '' })).status).toBe(400);
    await payer.post(`/api/admin/upgrades/${uid}/reject`, { reason: 'Amount does not match' });
    expect((await c.get(`/api/orders/${id}/status`)).body.order.upgrade).toMatchObject({ status: 'FAILED', note: 'Amount does not match' });
    expect((await c.post(`/api/orders/upgrades/${uid}/payment-proof`, { screenshot: PNG, reference: 'UP2' })).status).toBe(201);

    expect((await payer.post(`/api/admin/upgrades/${uid}/approve`)).status).toBe(200);
    expect((await payer.post(`/api/admin/upgrades/${uid}/approve`)).status).toBe(409);
    expect((await c.get(`/api/orders/${id}/status`)).body.order).toMatchObject({ status: 'PAID', amount: 1499, plan: { id: 'signature' }, upgrade: null });
    expect((await admin.get('/api/admin/stats')).body.stats).toMatchObject({ paymentRequests: 0, totalRevenue: 650 });

    await admin.patch(`/api/admin/orders/${id}`, { stage: 'IN_PRODUCTION' });
    expect((await c.post(`/api/orders/${id}/upgrade`, { planId: 'signature' })).status).toBe(409);
  });

  it('plan change before payment is requested: any plan, locked at "Payment Pending"', async () => {
    const admin = t.browser(); await admin.post('/api/auth/login', MAIN);
    const payer = t.browser(); await payer.post('/api/auth/login', SIDE);
    const c = t.browser(); await c.post('/api/auth/signup', signupBody('sw@example.com'));
    const id = (await c.post('/api/orders', { planId: 'signature' })).body.order.id;
    expect((await c.post(`/api/orders/${id}/upgrade`, { planId: 'foundation' })).body.order).toMatchObject({ amount: 249, plan: { id: 'foundation' } });
    expect((await c.post(`/api/orders/${id}/upgrade`, { planId: 'foundation' })).body.error.code).toBe('ALREADY_ON_PLAN');
    await admin.patch(`/api/admin/orders/${id}`, { stage: 'INFORMATION_CONFIRMED' });
    expect((await c.post(`/api/orders/${id}/upgrade`, { planId: 'studio' })).status).toBe(200);
    await admin.patch(`/api/admin/orders/${id}`, { stage: 'PAYMENT_PENDING' });
    expect((await c.post(`/api/orders/${id}/upgrade`, { planId: 'creator' })).body.error.code).toBe('PLAN_LOCKED');
  });
  it('upgrade can be cancelled before paying', async () => {
    const admin = t.browser(); await admin.post('/api/auth/login', MAIN);
    const payer = t.browser(); await payer.post('/api/auth/login', SIDE);
    const c = t.browser(); await c.post('/api/auth/signup', signupBody('cx@example.com'));
    const id = (await c.post('/api/orders', { planId: 'foundation' })).body.order.id;
    await admin.patch(`/api/admin/orders/${id}`, { status: 'PAID' });
    const uid = (await c.post(`/api/orders/${id}/upgrade`, { planId: 'creator' })).body.upgrade.id;
    expect((await c.del(`/api/orders/upgrades/${uid}`)).status).toBe(200);
    expect((await c.get(`/api/orders/${id}/status`)).body.order.upgrade).toBeNull();
    expect((await c.post(`/api/orders/upgrades/${uid}/payment-proof`, { screenshot: PNG })).status).toBe(409);
  });

  it('change password: old password required, the admin is informed, the client does not see the notice', async () => {
    const c = t.browser(); await c.post('/api/auth/signup', signupBody('chg@example.com'));
    const change = (b) => c.post('/api/auth/change-password', b);
    expect((await change({ currentPassword: 'wrongpass1', newPassword: 'newpass456', confirmPassword: 'newpass456' })).body.error.fields.currentPassword).toBe('Current password is wrong');
    expect((await change({ currentPassword: 'secret123', newPassword: 'short', confirmPassword: 'short' })).status).toBe(400);
    expect((await change({ currentPassword: 'secret123', newPassword: 'newpass456', confirmPassword: 'other1234' })).body.error.fields.confirmPassword).toBe('Passwords do not match');
    expect((await change({ currentPassword: 'secret123', newPassword: 'secret123', confirmPassword: 'secret123' })).body.error.fields.newPassword).toMatch(/different/);
    const admin = t.browser(); await admin.post('/api/auth/login', MAIN);
    const payer = t.browser(); await payer.post('/api/auth/login', SIDE);
    expect((await admin.get('/api/admin/stats')).body.stats.unreadMessages).toBe(0); // failed attempts tell nobody

    expect((await change({ currentPassword: 'secret123', newPassword: 'newpass456', confirmPassword: 'newpass456' })).status).toBe(200);
    expect((await t.browser().post('/api/auth/login', { email: 'chg@example.com', password: 'secret123' })).status).toBe(401);
    expect((await t.browser().post('/api/auth/login', { email: 'chg@example.com', password: 'newpass456' })).status).toBe(200);
    const conv = (await admin.get('/api/admin/messages?email=chg@example.com')).body.conversations[0];
    expect(conv).toMatchObject({ unread: 1 });
    expect(conv.messages[0]).toMatchObject({ from: 'system', message: expect.stringMatching(/password/i) });
    expect((await admin.get('/api/admin/stats')).body.stats.unreadMessages).toBe(1);
    expect((await c.get('/api/chat/inbox')).body.messages).toHaveLength(0);
    // Staff change their own password with the current one.
    const chg = (cur, next) => admin.post('/api/auth/change-password', { currentPassword: cur, newPassword: next, confirmPassword: next });
    expect((await chg('nope-nope1', 'newpass456')).body.error.code).toBe('WRONG_PASSWORD');
    expect((await chg(MAIN.password, 'newpass456')).status).toBe(200);
    expect((await t.browser().post('/api/auth/login', { email: MAIN.email, password: MAIN.password })).status).toBe(401);
    expect((await t.browser().post('/api/auth/login', { email: MAIN.email, password: 'newpass456' })).status).toBe(200);
  });
  it('messages: FAQ answers, guests need an email, the admin replies, the client reads it', async () => {
    const guest = t.browser();
    expect((await guest.post('/api/chat/message', { message: 'how much does it cost' })).body).toMatchObject({ type: 'faq', id: 21 });
    expect((await guest.post('/api/chat/message', { message: 'can you recommend a good restaurant nearby' })).body.type).toBe('need_email');
    expect((await guest.post('/api/chat/handoff', { message: 'Do you book wedding bands?' })).status).toBe(400);
    expect((await guest.post('/api/chat/handoff', { message: 'Do you book wedding bands?', email: 'Guest@Example.com' })).status).toBe(200);

    const c = t.browser(); await c.post('/api/auth/signup', signupBody('m@example.com'));
    await c.post('/api/chat/inbox', { message: 'Can you do Punjabi folk fusion?' });
    const admin = t.browser(); await admin.post('/api/auth/login', MAIN);
    const payer = t.browser(); await payer.post('/api/auth/login', SIDE);
    expect((await admin.get('/api/admin/stats')).body.stats.unreadMessages).toBe(2);
    expect((await admin.get('/api/admin/messages')).body.conversations.map((x) => x.email).sort()).toEqual(['guest@example.com', 'm@example.com']);
    expect((await admin.post('/api/admin/messages/reply', { email: 'm@example.com', message: 'Yes we can!' })).status).toBe(201);
    const inbox = (await c.get('/api/chat/inbox')).body;
    expect(inbox.messages.map((m) => [m.from, m.message])).toEqual([['me', 'Can you do Punjabi folk fusion?'], ['team', 'Yes we can!']]);
    expect(inbox.unread).toBe(1);
    await c.post('/api/chat/inbox/read');
    expect((await c.get('/api/chat/inbox')).body.unread).toBe(0);
    expect((await admin.get('/api/admin/stats')).body.stats.unreadMessages).toBe(1); // only the guest's
  });

  it('admin: set a new password, block / unblock, delete a client', async () => {
    const admin = t.browser(); await admin.post('/api/auth/login', MAIN);
    const payer = t.browser(); await payer.post('/api/auth/login', SIDE);
    const c = t.browser(); const su = await c.post('/api/auth/signup', signupBody('b@example.com'));
    const id = su.body.user.id;

    const pw = (await admin.post(`/api/admin/clients/${id}/password`)).body.password;
    expect(pw).toMatch(/[A-Za-z]/); expect(pw).toMatch(/\d/);
    expect((await t.browser().post('/api/auth/login', { email: 'b@example.com', password: 'secret123' })).status).toBe(401);
    expect((await t.browser().post('/api/auth/login', { email: 'b@example.com', password: pw })).status).toBe(200);

    await admin.patch(`/api/admin/clients/${id}`, { status: 'BLOCKED' });
    expect((await c.get('/api/orders')).status).toBe(401);
    expect((await t.browser().post('/api/auth/login', { email: 'b@example.com', password: pw })).body.error.code).toBe('ACCOUNT_BLOCKED');
    expect((await t.browser().post('/api/auth/signup', signupBody('b@example.com'))).status).toBe(403);
    await admin.patch(`/api/admin/clients/${id}`, { status: 'ACTIVE' });

    const c2 = t.browser(); await c2.post('/api/auth/login', { email: 'b@example.com', password: pw });
    await c2.post('/api/orders', { planId: 'creator' });
    expect((await admin.del(`/api/admin/clients/${id}`)).status).toBe(200);
    expect((await admin.get('/api/admin/clients')).body.clients).toHaveLength(0);
    expect((await admin.get('/api/admin/orders')).body.orders).toHaveLength(0);
    expect((await t.browser().post('/api/auth/signup', signupBody('b@example.com'))).status).toBe(201); // email is free again
  });

  it('data survives a "reload" (new engine on the same storage) and changes are announced', async () => {
    const mem = {};
    const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
    let n = 0;
    const e1 = SA.createEngine({ storage, plans, faq: () => faq, onChange: () => { n += 1; } });
    const ctx = { session: { userId: null } };
    await e1.handle('POST', '/api/auth/signup', signupBody('p@example.com'), ctx);
    expect(n).toBeGreaterThan(0);
    const e2 = SA.createEngine({ storage, plans, faq: () => faq });
    expect((await e2.handle('POST', '/api/auth/login', { email: 'p@example.com', password: 'secret123' }, { session: {} })).status).toBe(200);
  });

  it('discount codes: NEW-STAR on the first order only, referral 10% for the friend and a reward for the referrer once paid', async () => {
    const mk = async (email) => { const b = t.browser(); expect((await b.post('/api/auth/signup', signupBody(email))).status).toBe(201); return b; };
    const alice = await mk('alice@example.com'), bob = await mk('bob@example.com'), carol = await mk('carol@example.com');
    const main = t.browser(); await main.post('/api/auth/login', MAIN);
    const pays = t.browser(); await pays.post('/api/auth/login', SIDE);

    // NEW-STAR: 15% on the first order (the browser's own price is ignored), never again
    const c1 = await carol.post('/api/orders/check-code', { code: ' new-star ', planId: 'creator' });
    expect(c1.body).toMatchObject({ discount: { percent: 15, code: 'NEW-STAR' }, amount: 467 });
    expect((await carol.post('/api/orders/check-code', { code: 'NOPE' })).body.error.code).toBe('INVALID_CODE');
    const co = (await carol.post('/api/orders', { planId: 'creator', code: 'NEW-STAR', amount: 1 })).body.order;
    expect(co).toMatchObject({ amount: 467, discount: { percent: 15, listPrice: 549, saved: 82 } });
    await main.patch(`/api/admin/orders/${co.id}`, { status: 'CANCELLED' });
    expect((await carol.post('/api/orders', { planId: 'creator', code: 'NEW-STAR' })).status).toBe(201); // a cancelled order does not count
    const late = await t.browser(); await late.post('/api/auth/login', { email: 'carol@example.com', password: 'secret123' });

    // referral
    const info = (await alice.get('/api/orders/referral')).body.referral;
    expect(info.code).toMatch(/^STAR-[A-Z2-9]{6}$/);
    expect((await alice.post('/api/orders/check-code', { code: info.code })).body.error.message).toMatch(/own referral code/i);
    const bo = (await bob.post('/api/orders', { planId: 'studio', code: info.code.toLowerCase() })).body.order;
    expect(bo).toMatchObject({ amount: 764, discount: { percent: 10, kind: 'REFERRAL', listPrice: 849 } });
    expect((await bob.post(`/api/orders/${bo.id}/upgrade`, { planId: 'creator' })).body.order).toMatchObject({ amount: 494 });
    await main.patch(`/api/admin/orders/${bo.id}`, { stage: 'PAYMENT_PENDING' });
    expect((await bob.post(`/api/orders/${bo.id}/payment-proof`, { screenshot: PNG })).body.order.payment.amount).toBe(494);
    const pay = (await pays.get('/api/admin/payments')).body.payments.find((p) => p.order && p.order.id === bo.id);
    expect((await pays.post(`/api/admin/payments/${pay.id}/approve`)).status).toBe(200);
    expect((await alice.get('/api/orders/referral')).body.referral).toMatchObject({ friends: 1, earned: 1, rewardCredits: 1 });

    // the reward applies automatically to alice's next plan and is used up
    expect((await alice.post('/api/orders/check-code', { code: '', planId: 'signature' })).body).toMatchObject({ discount: { kind: 'REWARD' }, amount: 1349 });
    expect((await alice.post('/api/orders', { planId: 'signature' })).body.order).toMatchObject({ amount: 1349, discount: { kind: 'REWARD', percent: 10 } });
    expect((await alice.get('/api/orders/referral')).body.referral.rewardCredits).toBe(0);
    expect((await late.get('/api/orders')).status).toBe(200);
  });});
