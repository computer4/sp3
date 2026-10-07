// Integration tests: real Express app + real SQLite database (prisma/test.db) + the TEST payment gateway.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

const ORIGIN = 'http://localhost:4000';
let app, prisma, hashPassword;

const signupBody = (email, extra = {}) => ({
  name: 'Artist A',
  email,
  password: 'secret123',
  confirmPassword: 'secret123',
  mobile: '9876543210',
  ...extra,
});

async function signup(email, extra) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signup').set('Origin', ORIGIN).send(signupBody(email, extra));
  expect(res.status).toBe(201);
  // (the verification email can't be opened in a test — mark the address verified so payments are allowed)
  await prisma.user.updateMany({ where: { email: email.toLowerCase() }, data: { emailVerifiedAt: new Date() } });
  return { agent, user: res.body.user };
}

/** The admin from the brief: admin@gmail.com / ADMIN */
/** The payments admin (side admin): the only staff role that can confirm payments. */
async function payAdminAgent() {
  if (!(await prisma.user.findUnique({ where: { email: 'pay@gmail.com' } }))) {
    await prisma.user.create({ data: { name: 'Payments Admin', email: 'pay@gmail.com', mobile: '', role: 'PAYMENTS', passwordHash: await hashPassword('PAYPAY123'), emailVerifiedAt: new Date() } });
  }
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'pay@gmail.com', password: 'PAYPAY123' });
  expect(res.status).toBe(200);
  expect(res.body.user.role).toBe('PAYMENTS');
  return agent;
}
async function adminAgent() {
  if (!(await prisma.user.findUnique({ where: { email: 'admin@gmail.com' } }))) {
    await prisma.user.create({
      data: { name: 'Admin', email: 'admin@gmail.com', mobile: '', role: 'ADMIN', passwordHash: await hashPassword('ADMIN') },
    });
  }
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'admin@gmail.com', password: 'ADMIN' });
  expect(res.status).toBe(200);
  expect(res.body.user.role).toBe('ADMIN');
  return agent;
}

const apply = async (agent, planId) => {
  const res = await agent.post('/api/orders').set('Origin', ORIGIN).send({ planId, amount: 1, stage: 'COMPLETED', status: 'PAID' });
  return res;
};
const setOrder = (admin, id, body) => admin.patch(`/api/admin/orders/${id}`).set('Origin', ORIGIN).send(body);
// A real 1×1 PNG (the server checks the file signature, not just the label).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const sendProof = (agent, id, body = {}) => agent.post(`/api/orders/${id}/payment-proof`).set('Origin', ORIGIN).send({ screenshot: PNG, reference: 'UTR123456', ...body });
const approve = (admin, paymentId) => admin.post(`/api/admin/payments/${paymentId}/approve`).set('Origin', ORIGIN).send({});
const reject = (admin, paymentId, reason = 'Amount does not match') => admin.post(`/api/admin/payments/${paymentId}/reject`).set('Origin', ORIGIN).send({ reason });

/** Apply → admin requests payment → client sends the screenshot → admin approves / rejects (or leaves it waiting). */
async function applyAndPay(client, admin, planId, outcome) {
  const { body } = await apply(client, planId);
  await setOrder(admin, body.order.id, { stage: 'PAYMENT_PENDING' }).expect(200);
  await sendProof(client, body.order.id).expect(201);
  if (outcome) {
    const payment = await prisma.payment.findUnique({ where: { orderId: body.order.id } });
    const pa = await payAdminAgent(); // only the payments admin can confirm / reject
    await (outcome === 'success' ? approve(pa, payment.id) : reject(pa, payment.id)).expect(200);
  }
  return body.order.id;
}
beforeAll(async () => {
  ({ prisma } = await import('../src/lib/prisma.js'));
  ({ hashPassword } = await import('../src/lib/password.js'));
  const { createApp } = await import('../src/app.js');
  app = createApp();
  const { loadPlans } = await import('../src/lib/plans.js');
  for (const [i, p] of loadPlans().entries()) {
    const data = { name: p.name, price: p.price, originalPrice: p.originalPrice, description: p.description, features: JSON.stringify(p.features), finalOutput: p.finalOutput, sortOrder: i };
    await prisma.plan.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
  }
});

beforeEach(async () => {
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => prisma?.$disconnect());

describe('authentication', () => {
  it('signs up as CLIENT (even if the request says ADMIN) and hashes the password', async () => {
    const { agent, user } = await signup('a@example.com', { role: 'ADMIN' });
    expect(user.role).toBe('CLIENT');
    const row = await prisma.user.findUnique({ where: { email: 'a@example.com' } });
    expect(row).toMatchObject({ role: 'CLIENT', status: 'ACTIVE' });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('a@example.com');
  });

  it('rejects invalid fields', async () => {
    const res = await request(app).post('/api/auth/signup').set('Origin', ORIGIN)
      .send({ name: '', email: 'nope', password: 'short', confirmPassword: 'x', mobile: '12' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['confirmPassword', 'email', 'mobile', 'name', 'password']);
  });

  it('duplicate email / unknown email / wrong password give the exact messages', async () => {
    await signup('b@example.com');
    const dup = await request(app).post('/api/auth/signup').set('Origin', ORIGIN).send(signupBody('B@example.com'));
    expect(dup.body.error.message).toBe('This Email is already registered');
    const unknown = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'x@example.com', password: 'secret123' });
    expect(unknown.body.error.message).toBe("This Email isn't registered");
    const wrong = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'b@example.com', password: 'wrongpass1' });
    expect(wrong.body.error.message).toBe('Password is wrong');
    expect((await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'b@example.com', password: 'secret123' })).status).toBe(200);
  });

  it('logout ends the session; dashboard data needs a login', async () => {
    const { agent } = await signup('c@example.com');
    await agent.post('/api/auth/logout').set('Origin', ORIGIN).expect(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/orders')).status).toBe(401);
  });

  it('admin@gmail.com / ADMIN logs in as ADMIN; clients get 403 on the admin API', async () => {
    await adminAgent();
    const { agent } = await signup('d@example.com');
    expect((await agent.get('/api/admin/stats')).status).toBe(403);
    expect((await request(app).get('/api/admin/stats')).status).toBe(401);
  });
});

describe('plans & project stages', () => {
  it('taking a plan creates an application: Applied / Review / unpaid, price from the server', async () => {
    const { agent } = await signup('e@example.com');
    const res = await apply(agent, 'creator');
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ amount: 549, stage: 'APPLIED', workState: 'REVIEW', status: 'PENDING', paymentStatus: 'UNPAID', active: true });
    expect(await prisma.payment.count()).toBe(0);
  });

  it('only one active plan at a time; a new one is allowed after completion', async () => {
    const { agent } = await signup('f@example.com');
    const first = (await apply(agent, 'creator')).body.order;
    const second = await apply(agent, 'studio');
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ACTIVE_PLAN_EXISTS');
    const admin = await adminAgent();
    await setOrder(admin, first.id, { stage: 'COMPLETED' }).expect(200);
    expect((await apply(agent, 'studio')).status).toBe(201);
    const { orders } = (await agent.get('/api/orders')).body;
    expect(orders.map((o) => [o.plan.id, o.active])).toEqual([['studio', true], ['creator', false]]); // past subscription kept
  });

  it('cannot send payment details before the admin requests payment', async () => {
    const { agent } = await signup('g@example.com');
    const { order } = (await apply(agent, 'creator')).body;
    const res = await sendProof(agent, order.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_NOT_REQUESTED');
  });

  it('payment details: screenshot required and checked; sending puts the order "under verification"', async () => {
    const client = await signup('h1@example.com');
    const admin = await adminAgent();
    const { body } = await apply(client.agent, 'creator');
    const id = body.order.id;
    await setOrder(admin, id, { stage: 'PAYMENT_PENDING' }).expect(200);

    expect((await sendProof(client.agent, id, { screenshot: undefined })).status).toBe(400);
    expect((await sendProof(client.agent, id, { screenshot: 'data:image/png;base64,AAAA' + 'A'.repeat(200) })).status).toBe(400); // not a real image
    expect((await sendProof(client.agent, id, { screenshot: 'data:image/svg+xml;base64,' + 'A'.repeat(200) })).status).toBe(400);

    const ok = await sendProof(client.agent, id).expect(201);
    expect(ok.body.order).toMatchObject({ status: 'PAYMENT_PROCESSING', paymentStatus: 'PENDING', stage: 'PAYMENT_PENDING' });
    expect(ok.body.order.payment).toMatchObject({ reference: 'UTR123456', hasProof: true, method: 'UPI QR' });
    expect((await sendProof(client.agent, id)).body.error.code).toBe('ALREADY_SUBMITTED'); // only once while waiting

    // The client can see their own screenshot; the admin gets a "payment request" count.
    expect((await client.agent.get(`/api/orders/${id}/proof`)).headers['content-type']).toBe('image/png');
    expect((await admin.get('/api/admin/stats')).body.stats.paymentRequests).toBe(1);
    const row = (await admin.get('/api/admin/payments')).body.payments[0];
    expect(row).toMatchObject({ status: 'PENDING', reference: 'UTR123456', screenshotUrl: expect.stringContaining('/screenshot') });
    expect((await admin.get(row.screenshotUrl)).headers['content-type']).toBe('image/png');
  });

  it('admin confirms → PAID, payment SUCCESS, stage moves to Invoice Issued (dashboard data)', async () => {
    const client = await signup('h@example.com');
    const admin = await adminAgent();
    const id = await applyAndPay(client.agent, admin, 'signature', 'success');
    const { order } = (await client.agent.get(`/api/orders/${id}/status`)).body;
    expect(order).toMatchObject({ status: 'PAID', paymentStatus: 'SUCCESS', stage: 'INVOICE_ISSUED', amount: 1499, paymentIncomplete: false });
    expect((await sendProof(client.agent, id)).status).toBe(409); // already paid
    expect((await admin.get('/api/admin/stats')).body.stats).toMatchObject({ paymentRequests: 0, totalRevenue: 1499 });
  });

  it('admin rejects → reason shown, the client can send the payment again', async () => {
    const client = await signup('i@example.com');
    const admin = await adminAgent();
    const id = await applyAndPay(client.agent, admin, 'studio', 'failed');
    let row = await prisma.order.findUnique({ where: { id }, include: { payment: true } });
    expect(row.status).toBe('PENDING');
    expect(row.payment).toMatchObject({ status: 'FAILED', note: 'Amount does not match' });
    expect(row.stage).toBe('PAYMENT_PENDING');
    expect((await admin.get(`/api/admin/orders/${id}`)).body.order.paymentIncomplete).toBe(true);

    await sendProof(client.agent, id, { reference: 'UTR999' }).expect(201); // resend
    row = await prisma.order.findUnique({ where: { id }, include: { payment: true } });
    expect(row.status).toBe('PAYMENT_PROCESSING');
    expect(row.payment).toMatchObject({ status: 'PENDING', note: null, reference: 'UTR999' });
    const pay = await payAdminAgent();
    expect((await approve(admin, row.payment.id)).status).toBe(403); // the main admin can't confirm payments
    expect((await approve(pay, row.payment.id)).status).toBe(200);
    expect((await approve(pay, row.payment.id)).status).toBe(409); // can't approve twice
  });

  it('only the admin can verify payments', async () => {
    const client = await signup('i2@example.com');
    const admin = await adminAgent();
    const id = await applyAndPay(client.agent, admin, 'studio');
    const payment = await prisma.payment.findUnique({ where: { orderId: id } });
    expect((await approve(client.agent, payment.id)).status).toBe(403);
    expect((await client.agent.get(`/api/admin/payments/${payment.id}/screenshot`)).status).toBe(403);
    expect((await reject(await payAdminAgent(), payment.id, '')).status).toBe(400); // a reason is required
  });
  it('users only see their own orders', async () => {
    const a = await signup('j@example.com');
    const b = await signup('k@example.com');
    const { order } = (await apply(a.agent, 'studio')).body;
    expect((await b.agent.get(`/api/orders/${order.id}/status`)).status).toBe(404);
    expect((await sendProof(b.agent, order.id)).status).toBe(404);
    expect((await b.agent.get('/api/orders')).body.orders).toHaveLength(0);
  });

});

describe('admin', () => {
  it('counters follow Run / Complete / Back to review', async () => {
    const admin = await adminAgent();
    const ids = [];
    for (const e of ['l1@example.com', 'l2@example.com', 'l3@example.com']) {
      const c = await signup(e);
      ids.push((await apply(c.agent, 'creator')).body.order.id);
    }
    const stats = async () => (await admin.get('/api/admin/stats')).body.stats;
    expect(await stats()).toMatchObject({ totalClients: 3, inReview: 3, inProcess: 0, completed: 0 });

    await setOrder(admin, ids[0], { workState: 'PROCESS' }).expect(200); // Run
    await setOrder(admin, ids[1], { workState: 'PROCESS' }).expect(200);
    await setOrder(admin, ids[1], { workState: 'COMPLETED' }).expect(200); // Complete
    expect(await stats()).toMatchObject({ inReview: 1, inProcess: 1, completed: 1 });

    await setOrder(admin, ids[1], { workState: 'REVIEW' }).expect(200); // completed → back to review
    await setOrder(admin, ids[0], { workState: 'REVIEW' }).expect(200); // process → back to review
    expect(await stats()).toMatchObject({ inReview: 3, inProcess: 0, completed: 0 });

    const inReview = (await admin.get('/api/admin/orders?workState=REVIEW')).body.orders;
    expect(inReview).toHaveLength(3);
    expect((await setOrder(admin, ids[0], { stage: 'NOT_A_STAGE' })).status).toBe(400);
  });

  it('admin sees clients, projects, payments; payment incomplete is counted', async () => {
    const c1 = await signup('m@example.com');
    const c2 = await signup('n@example.com');
    const admin = await adminAgent();
    await applyAndPay(c1.agent, admin, 'creator', 'success');
    const { order } = (await apply(c2.agent, 'studio')).body;
    await setOrder(admin, order.id, { stage: 'PAYMENT_PENDING' }).expect(200);

    const { stats } = (await admin.get('/api/admin/stats')).body;
    expect(stats).toMatchObject({ totalClients: 2, paymentIncomplete: 1, totalRevenue: 549 });
    const { clients } = (await admin.get('/api/admin/clients')).body;
    expect(clients.map((c) => c.email).sort()).toEqual(['m@example.com', 'n@example.com']);
    expect(JSON.stringify(clients)).not.toMatch(/passwordHash|argon2/);
    const detail = (await admin.get(`/api/admin/clients/${c1.user.id}`)).body.client;
    expect(detail.orders[0]).toMatchObject({ status: 'PAID', stage: 'INVOICE_ISSUED' });
    expect((await admin.get('/api/admin/orders?paymentIncomplete=1')).body.orders).toHaveLength(1);
    expect((await admin.get('/api/admin/payments')).body.payments).toHaveLength(1);
  });

  it('block: signed out, cannot log in or sign up again with that email; unblock restores', async () => {
    const c = await signup('o@example.com');
    const admin = await adminAgent();
    await admin.patch(`/api/admin/clients/${c.user.id}`).set('Origin', ORIGIN).send({ status: 'BLOCKED' }).expect(200);
    expect((await c.agent.get('/api/orders')).status).toBe(401);
    const login = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'o@example.com', password: 'secret123' });
    expect(login.body.error.code).toBe('ACCOUNT_BLOCKED');
    const again = await request(app).post('/api/auth/signup').set('Origin', ORIGIN).send(signupBody('o@example.com'));
    expect(again.status).toBe(403);
    expect(again.body.error.message).toBe('This email has been blocked. Please contact STAR PRODUCTION.');

    await admin.patch(`/api/admin/clients/${c.user.id}`).set('Origin', ORIGIN).send({ status: 'ACTIVE' }).expect(200);
    expect((await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'o@example.com', password: 'secret123' })).status).toBe(200);
  });

  it('delete: removes the client and all their plans/payments; the email can start fresh', async () => {
    const c = await signup('p@example.com');
    const admin = await adminAgent();
    await applyAndPay(c.agent, admin, 'creator', 'success');
    const del = await admin.delete(`/api/admin/clients/${c.user.id}`).set('Origin', ORIGIN);
    expect(del.status).toBe(200);
    expect(await prisma.user.count({ where: { email: 'p@example.com' } })).toBe(0);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    expect((await c.agent.get('/api/auth/me')).status).toBe(401);

    const fresh = await signup('p@example.com'); // same email, brand-new account
    expect((await fresh.agent.get('/api/orders')).body.orders).toHaveLength(0);
    expect((await admin.delete(`/api/admin/clients/${(await prisma.user.findUnique({ where: { email: 'admin@gmail.com' } })).id}`).set('Origin', ORIGIN)).status).toBe(400);
  });
});

describe('database persistence', () => {
  it('users, orders and plans survive a new database connection (like a restart)', async () => {
    const c = await signup('persist@example.com');
    const admin = await adminAgent();
    await applyAndPay(c.agent, admin, 'creator', 'success');
    await prisma.$disconnect();
    const fresh = new PrismaClient();
    try {
      const user = await fresh.user.findUnique({ where: { email: 'persist@example.com' }, include: { orders: { include: { payment: true } } } });
      expect(user.orders[0]).toMatchObject({ status: 'PAID', stage: 'INVOICE_ISSUED', amount: 549 });
      expect(await fresh.plan.count()).toBe(4);
    } finally {
      await fresh.$disconnect();
    }
  });
});

describe('website', () => {
  it('serves the website, the dashboard and admin pages and their assets, without exposing project files', async () => {
    const home = await request(app).get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('STAR PRODUCTION');
    for (const p of ['/dashboard', '/dashboard.html']) {
      const r = await request(app).get(p);
      expect(r.status).toBe(200);
      expect(r.text).toContain('assets/dashboard.js');
    }
    for (const p of ['/admin', '/admin.html']) {
      const r = await request(app).get(p);
      expect(r.status).toBe(200);
      expect(r.text).toContain('assets/admin.js');
    }
    for (const p of ['/assets/common.js', '/assets/dashboard.js', '/assets/admin.js', '/assets/site.css', '/chat-widget.js', '/data/chat/faq.js']) {
      expect((await request(app).get(p)).status, p).toBe(200);
    }
    expect((await request(app).get('/login')).headers.location).toBe('/#/login');
    for (const p of ['/.env', '/server/src/app.js', '/package.json', '/server/prisma/test.db']) {
      expect((await request(app).get(p)).status).toBe(404);
    }
  });
});
