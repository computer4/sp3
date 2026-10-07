import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';

const ORIGIN = 'http://localhost:4000';
let app, answerMessage, FAQS, prisma, hashPassword;

beforeAll(async () => {
  ({ createApp: app } = await import('../src/app.js'));
  app = app();
  ({ answerMessage, FAQS } = createRequire(import.meta.url)('../../data/chat/faq.js'));
  ({ prisma } = await import('../src/lib/prisma.js'));
  ({ hashPassword } = await import('../src/lib/password.js'));
});

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
    await prisma.user.create({ data: { name: 'Admin', email: 'admin@gmail.com', mobile: '', role: 'ADMIN', passwordHash: await hashPassword('ADMIN') } });
  }
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'admin@gmail.com', password: 'ADMIN' });
  expect(res.status).toBe(200);
  return agent;
}

const send = (message) => request(app).post('/api/chat/message').set('Origin', ORIGIN).send({ message });

describe('FAQ matcher', () => {
  it('answers every FAQ question with its own answer', () => {
    for (const f of FAQS) {
      const r = answerMessage(f.q);
      expect(r.type, f.q).toBe('faq');
      expect(r.faq.id, f.q).toBe(f.id);
    }
  });

  it('understands rephrased questions', () => {
    const id = (q) => answerMessage(q).faq?.id;
    expect(id('how much does it cost')).toBe(21);
    expect(id('can i get my money back')).toBe(29);
    expect(id('do you accept gpay')).toBe(26);
    expect(id('i forgot my password')).toBe(44);
    expect(id('what is mastering')).toBe(14);
    expect(id('what do you do')).toBe(1);
  });

  it('treats unrelated topics as unknown and ignores greetings/noise', () => {
    expect(answerMessage('what is the weather today').type).toBe('unknown');
    expect(answerMessage('can you do my taxes').type).toBe('unknown');
    expect(answerMessage('hello there').type).toBe('greeting');
    expect(answerMessage('thanks a lot').type).toBe('thanks');
    expect(answerMessage('asdf').type).toBe('clarify');
  });
});

describe('chat API', () => {
  it('returns the FAQ answer exactly as written', async () => {
    const res = await send('Are the prices per song?');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('faq');
    expect(res.body.answer).toBe('Yes. All STAR PRODUCTION plans are priced per song.');
  });

  it('asks a guest for an email when the question is off-topic (nothing is sent yet)', async () => {
    const res = await send('can you recommend a good restaurant nearby');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('need_email');
  });

  it('hand-off needs a valid email from guests, then sends', async () => {
    const msg = 'Do you also do wedding band bookings?';
    const noEmail = await request(app).post('/api/chat/handoff').set('Origin', ORIGIN).send({ message: msg });
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error.fields.email).toBeTruthy();

    const badEmail = await request(app).post('/api/chat/handoff').set('Origin', ORIGIN).send({ message: msg, email: 'nope' });
    expect(badEmail.status).toBe(400);

    const ok = await request(app).post('/api/chat/handoff').set('Origin', ORIGIN).send({ message: msg, email: 'Artist@Example.com' });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    await request(app).post('/api/chat/handoff').set('Origin', ORIGIN).send({ message: 'Second question about bookings', email: 'artist@example.com' }).expect(200);
  });

  it('shows messages to the admin, grouped per client, and lets them mark read / delete', async () => {
    await prisma.chatMessage.deleteMany();
    const post = (m, e) => request(app).post('/api/chat/handoff').set('Origin', ORIGIN).send({ message: m, email: e }).expect(200);
    await post('Question one', 'a@example.com');
    await post('Question two', 'A@example.com');
    await post('Other client question', 'b@example.com');

    // Only admins may read them.
    expect((await request(app).get('/api/admin/messages')).status).toBe(401);

    const admin = await adminAgent();
    const list = await admin.get('/api/admin/messages').expect(200);
    expect(list.body.conversations).toHaveLength(2);
    const a = list.body.conversations.find((c) => c.email === 'a@example.com');
    expect(a.total).toBe(2);
    expect(a.unread).toBe(2);
    expect(a.messages.map((m) => m.message)).toEqual(['Question one', 'Question two']);
    expect((await admin.get('/api/admin/stats')).body.stats.unreadMessages).toBe(3);

    await admin.post('/api/admin/messages/status').set('Origin', ORIGIN).send({ email: 'a@example.com', status: 'READ' }).expect(200);
    expect((await admin.get('/api/admin/stats')).body.stats.unreadMessages).toBe(1);

    await admin.delete(`/api/admin/messages/${a.messages[0].id}`).set('Origin', ORIGIN).expect(200);
    const after = await admin.get('/api/admin/messages').expect(200);
    expect(after.body.conversations.find((c) => c.email === 'a@example.com').total).toBe(1);
  });

  it('admin replies reach the client dashboard inbox; the client can write back', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/signup').set('Origin', ORIGIN).send({
      name: 'Inbox Client', email: 'inbox@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210',
    }).expect(201);
    await agent.post('/api/chat/inbox').set('Origin', ORIGIN).send({ message: 'Can you do a Punjabi folk fusion?' }).expect(200);

    const admin = await adminAgent();
    await admin.post('/api/admin/messages/reply').set('Origin', ORIGIN).send({ email: 'inbox@example.com', message: 'Yes we can!' }).expect(201);

    const inbox = await agent.get('/api/chat/inbox').expect(200);
    expect(inbox.body.messages.map((m) => [m.from, m.message])).toEqual([['me', 'Can you do a Punjabi folk fusion?'], ['team', 'Yes we can!']]);
    expect(inbox.body.unread).toBe(1);
    await agent.post('/api/chat/inbox/read').set('Origin', ORIGIN).expect(200);
    expect((await agent.get('/api/chat/inbox')).body.unread).toBe(0);

    // The admin's unread counter only counts the client's own messages, and the reply cleared the new one.
    const conv = (await admin.get('/api/admin/messages?email=inbox@example.com')).body.conversations[0];
    expect(conv.unread).toBe(0);
    expect(conv.messages.map((m) => m.from)).toEqual(['client', 'team']);

    // Another client never sees it.
    const other = request.agent(app);
    await other.post('/api/auth/signup').set('Origin', ORIGIN).send({
      name: 'Other', email: 'other@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543211',
    }).expect(201);
    expect((await other.get('/api/chat/inbox')).body.messages).toHaveLength(0);
    // Clients can't use admin endpoints.
    await other.post('/api/admin/messages/reply').set('Origin', ORIGIN).send({ email: 'inbox@example.com', message: 'hi' }).expect(403);
  });

  it('admin can set a new password for a client (the old one stops working)', async () => {
    const agent = request.agent(app);
    const su = await agent.post('/api/auth/signup').set('Origin', ORIGIN).send({
      name: 'Pw Client', email: 'pw@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210',
    }).expect(201);
    const admin = await adminAgent();
    const res = await admin.post(`/api/admin/clients/${su.body.user.id}/password`).set('Origin', ORIGIN).send({}).expect(200);
    expect(res.body.password).toMatch(/[A-Za-z]/);
    expect(res.body.password).toMatch(/\d/);
    await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'pw@example.com', password: 'secret123' }).expect(401);
    await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'pw@example.com', password: res.body.password }).expect(200);
  });

  it('upgrade: unpaid switches plan instantly, paid creates an upgrade payment, only higher plans, only before production', async () => {
    const { loadPlans } = await import('../src/lib/plans.js');
    for (const [i, p] of loadPlans().entries()) {
      const data = { name: p.name, price: p.price, originalPrice: p.originalPrice, description: p.description, features: JSON.stringify(p.features), finalOutput: p.finalOutput, sortOrder: i };
      await prisma.plan.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
    }
    const agent = request.agent(app);
    await agent.post('/api/auth/signup').set('Origin', ORIGIN).send({
      name: 'Up Client', email: 'up@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210',
    }).expect(201);
    const created = await agent.post('/api/orders').set('Origin', ORIGIN).send({ planId: 'foundation' }).expect(201);
    const id = created.body.order.id;

    await agent.post(`/api/orders/${id}/upgrade`).set('Origin', ORIGIN).send({ planId: 'foundation' }).expect(400); // not higher
    const up = await agent.post(`/api/orders/${id}/upgrade`).set('Origin', ORIGIN).send({ planId: 'studio' }).expect(200);
    expect(up.body.applied).toBe(true);
    expect(up.body.order.plan.id).toBe('studio');
    expect(up.body.order.amount).toBe(849);

    // Paid order → a second QR payment of the difference (not an instant switch).
    await prisma.order.update({ where: { id }, data: { status: 'PAID' } });
    const req = await agent.post(`/api/orders/${id}/upgrade`).set('Origin', ORIGIN).send({ planId: 'signature' }).expect(200);
    expect(req.body).toMatchObject({ requested: true, remaining: 1499 - 849, upgrade: { status: 'CREATED', amount: 650, fromPlanId: 'studio', toPlanId: 'signature' } });
    expect((await prisma.order.findUnique({ where: { id } })).planId).toBe('studio'); // unchanged until the admin confirms
    const orderView = (await agent.get(`/api/orders/${id}/status`)).body.order;
    expect(orderView.upgrade).toMatchObject({ id: req.body.upgrade.id, status: 'CREATED' });

    // Too late once production starts.
    await prisma.order.update({ where: { id }, data: { stage: 'IN_PRODUCTION' } });
    await agent.post(`/api/orders/${id}/upgrade`).set('Origin', ORIGIN).send({ planId: 'signature' }).expect(409);
  });

  it('plan change before payment is requested: any plan (even a cheaper one), locked once "Payment Pending"', async () => {
    const { loadPlans } = await import('../src/lib/plans.js');
    for (const [i, p] of loadPlans().entries()) {
      const data = { name: p.name, price: p.price, originalPrice: p.originalPrice, description: p.description, features: JSON.stringify(p.features), finalOutput: p.finalOutput, sortOrder: i };
      await prisma.plan.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
    }
    const agent = request.agent(app);
    await agent.post('/api/auth/signup').set('Origin', ORIGIN).send({ name: 'Switcher', email: 'switch@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210' }).expect(201);
    const id = (await agent.post('/api/orders').set('Origin', ORIGIN).send({ planId: 'signature' }).expect(201)).body.order.id;
    const change = (planId) => agent.post(`/api/orders/${id}/upgrade`).set('Origin', ORIGIN).send({ planId });

    const down = await change('foundation').expect(200); // cheaper plan is fine
    expect(down.body.order).toMatchObject({ amount: 249, plan: { id: 'foundation' } });
    expect((await change('foundation')).body.error.code).toBe('ALREADY_ON_PLAN');
    expect((await change('creator')).body.order.amount).toBe(549);

    const admin = await adminAgent();
    await admin.patch(`/api/admin/orders/${id}`).set('Origin', ORIGIN).send({ stage: 'INFORMATION_CONFIRMED' }).expect(200);
    expect((await change('studio')).status).toBe(200); // still before "Payment Pending"
    await admin.patch(`/api/admin/orders/${id}`).set('Origin', ORIGIN).send({ stage: 'PAYMENT_PENDING' }).expect(200);
    const locked = await change('creator');
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('PLAN_LOCKED');
    expect((await prisma.order.findUnique({ where: { id } })).planId).toBe('studio');
  });
  it('email verification flow: signup → email → click → only then can they log in; resend; payments need it', async () => {
    const { settings } = await import('../src/config/env.js');
    const { hashToken } = await import('../src/lib/tokens.js');
    const { loadPlans } = await import('../src/lib/plans.js');
    for (const [i, p] of loadPlans().entries()) {
      const data = { name: p.name, price: p.price, originalPrice: p.originalPrice, description: p.description, features: JSON.stringify(p.features), finalOutput: p.finalOutput, sortOrder: i };
      await prisma.plan.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
    }
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const body = { name: 'Verify Me', email: 'verify@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210' };
    const login = (password = 'secret123') => request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'verify@example.com', password });
    settings.requireEmailVerification = true;
    try {
      // 2–6: the account is created unverified, a link is generated and emailed — and there is NO session yet.
      const agent = request.agent(app);
      const su = await agent.post('/api/auth/signup').set('Origin', ORIGIN).send(body).expect(201);
      expect(su.body).toMatchObject({ needsVerification: true, emailSent: true, user: { emailVerified: false } });
      const userId = su.body.user.id;
      expect(await prisma.emailVerificationToken.count({ where: { userId, usedAt: null } })).toBe(1);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
      expect((await request(app).post('/api/auth/signup').set('Origin', ORIGIN).send(body)).body.error.message).toBe('This Email is already registered');

      // Logging in is blocked until the email is verified (a wrong password still just says so).
      const blocked = await login();
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      expect((await login('wrongpass1')).body.error.message).toBe('Password is wrong');

      // 8–9: the link is checked — wrong and expired links are refused.
      expect((await request(app).post('/api/auth/verify-email').set('Origin', ORIGIN).send({ token: 'not-a-real-token-at-all' })).body.error.code).toBe('VERIFY_TOKEN_INVALID');
      await prisma.emailVerificationToken.create({ data: { userId, tokenHash: hashToken('expired-token-123456'), expiresAt: new Date(Date.now() - 1000) } });
      expect((await request(app).post('/api/auth/verify-email').set('Origin', ORIGIN).send({ token: 'expired-token-123456' })).status).toBe(400);

      // "Option to resend": works without logging in, never reveals which addresses exist, at most one link a minute.
      const pub = (email) => request(app).post('/api/auth/resend-verification-public').set('Origin', ORIGIN).send({ email });
      const a = await pub('verify@example.com');
      const b = await pub('nobody@example.com');
      expect(a.status).toBe(200);
      expect(a.body).toEqual(b.body); // identical answer
      const unused = () => prisma.emailVerificationToken.count({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } } });
      expect(await unused()).toBe(1); // signup just sent one → no second link within a minute
      await prisma.emailVerificationToken.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
      const before = await prisma.emailVerificationToken.findFirst({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } } });
      await pub('verify@example.com');
      const after = await prisma.emailVerificationToken.findFirst({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } } });
      expect(after.id).not.toBe(before.id); // a fresh link replaced the old one
      expect(await unused()).toBe(1);

      // 9 → yes: valid token → verified, token used up, success.
      await prisma.emailVerificationToken.create({ data: { userId, tokenHash: hashToken('good-token-1234567890'), expiresAt: new Date(Date.now() + 3600_000) } });
      const ok = await request(app).post('/api/auth/verify-email').set('Origin', ORIGIN).send({ token: 'good-token-1234567890' });
      expect(ok.status).toBe(200);
      expect(ok.body.email).toBe('verify@example.com');
      expect((await request(app).post('/api/auth/verify-email').set('Origin', ORIGIN).send({ token: 'good-token-1234567890' })).status).toBe(200); // opening it again is harmless

      // Allow login / access dashboard.
      const inOk = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'verify@example.com', password: 'secret123' }).expect(200);
      expect(inOk.body.user.emailVerified).toBe(true);
      expect((await agent.post('/api/auth/resend-verification').set('Origin', ORIGIN).send({})).body.alreadyVerified).toBe(true);

      // Payments: only with a verified email.
      const id = (await agent.post('/api/orders').set('Origin', ORIGIN).send({ planId: 'creator' }).expect(201)).body.order.id;
      const admin = await adminAgent();
      await admin.patch(`/api/admin/orders/${id}`).set('Origin', ORIGIN).send({ stage: 'PAYMENT_PENDING' }).expect(200);
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: null } }); // (as if it were not verified)
      const gated = await agent.post(`/api/orders/${id}/payment-proof`).set('Origin', ORIGIN).send({ screenshot: png });
      expect(gated.status).toBe(403);
      expect(gated.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      expect((await agent.post(`/api/orders/${id}/payment-proof`).set('Origin', ORIGIN).send({ screenshot: png })).status).toBe(201);
      const pay = await prisma.payment.findUnique({ where: { orderId: id } });
      expect((await (await payAdminAgent()).post(`/api/admin/payments/${pay.id}/approve`).set('Origin', ORIGIN).send({})).status).toBe(200); // → invoice
    } finally {
      settings.requireEmailVerification = false;
    }
  });

  it('with no email provider (or verification switched off) a new client is verified at signup and logged straight in', async () => {
    const agent = request.agent(app);
    const su = await agent.post('/api/auth/signup').set('Origin', ORIGIN).send({ name: 'Instant', email: 'instant@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210' }).expect(201);
    expect(su.body.needsVerification).toBeUndefined();
    expect(su.body.user.emailVerified).toBe(true);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('admin can mark a client\'s email as verified (when their mail never arrives) so they can log in', async () => {
    const { settings } = await import('../src/config/env.js');
    settings.requireEmailVerification = true;
    try {
      const su = await request(app).post('/api/auth/signup').set('Origin', ORIGIN).send({ name: 'No Mail', email: 'nomail@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210' }).expect(201);
      const login = () => request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'nomail@example.com', password: 'secret123' });
      expect((await login()).status).toBe(403);
      const admin = await adminAgent();
      expect((await admin.get('/api/admin/clients')).body.clients.find((c) => c.email === 'nomail@example.com').emailVerified).toBe(false);
      expect((await (await payAdminAgent()).post(`/api/admin/clients/${su.body.user.id}/verify-email`).set('Origin', ORIGIN).send({})).status).toBe(403);
      expect((await admin.post(`/api/admin/clients/${su.body.user.id}/verify-email`).set('Origin', ORIGIN).send({})).body.client.emailVerified).toBe(true);
      expect((await login()).status).toBe(200);
    } finally {
      settings.requireEmailVerification = false;
    }
  });
  it('staff roles: the main admin sees everything but cannot confirm payments; the payments admin sees payments and confirms them only', async () => {
    const main = await adminAgent();
    const pay = await payAdminAgent();
    const client = request.agent(app);
    const su = await client.post('/api/auth/signup').set('Origin', ORIGIN).send({ name: 'Roles Client', email: 'roles@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210' }).expect(201);
    const cid = su.body.user.id;

    // Both: the overview numbers (revenue, clients, projects), projects, payments, messages.
    for (const who of [main, pay]) {
      const stats = (await who.get('/api/admin/stats')).body.stats;
      expect(stats).toEqual(expect.objectContaining({ totalRevenue: expect.any(Number), totalClients: expect.any(Number), inReview: expect.any(Number), inProcess: expect.any(Number), completed: expect.any(Number) }));
      expect((await who.get('/api/admin/orders')).status).toBe(200);
      expect((await who.get('/api/admin/payments')).status).toBe(200);
      expect((await who.get('/api/admin/messages')).status).toBe(200);
      expect((await who.post('/api/admin/messages/reply').set('Origin', ORIGIN).send({ email: 'roles@example.com', message: 'Hello from staff' })).status).toBe(201); // both can message clients
    }
    expect((await client.get('/api/chat/inbox')).body.messages).toHaveLength(2);

    // Main admin only: client details and everything that changes a client or project, and the email log.
    for (const [method, path, body] of [['get', '/api/admin/clients'], ['get', `/api/admin/clients/${cid}`], ['post', `/api/admin/clients/${cid}/password`, { password: 'secret123' }],
      ['post', `/api/admin/clients/${cid}/verify-email`, {}], ['patch', `/api/admin/clients/${cid}`, { status: 'BLOCKED' }], ['get', '/api/admin/emails']]) {
      expect((await main[method](path).set('Origin', ORIGIN).send(body ?? undefined)).status, `main ${method} ${path}`).toBe(200);
      expect((await pay[method](path).set('Origin', ORIGIN).send(body ?? undefined)).status, `payments admin ${method} ${path}`).toBe(403);
    }
    await main.patch(`/api/admin/clients/${cid}`).set('Origin', ORIGIN).send({ status: 'ACTIVE' }).expect(200);
    expect((await pay.patch('/api/admin/orders/whatever').set('Origin', ORIGIN).send({ stage: 'COMPLETED' })).status).toBe(403); // projects: read-only for the payments admin

    // Payments: only the payments admin confirms or rejects.
    for (const action of ['approve', 'reject']) {
      const res = await main.post(`/api/admin/payments/any-id/${action}`).set('Origin', ORIGIN).send({ reason: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/payments admin/i);
      expect((await main.post(`/api/admin/upgrades/any-id/${action}`).set('Origin', ORIGIN).send({ reason: 'x' })).status).toBe(403);
      expect((await pay.post(`/api/admin/payments/missing/${action}`).set('Origin', ORIGIN).send({ reason: 'x' })).status).toBe(404); // allowed — the payment just doesn't exist
    }

    // Staff accounts: password change needs the current password (no reset by email), and clients cannot reach the admin API.
    const chg = (cur, next) => pay.post('/api/auth/change-password').set('Origin', ORIGIN).send({ currentPassword: cur, newPassword: next, confirmPassword: next });
    expect((await chg('wrong-one1', 'newpass456')).body.error.code).toBe('WRONG_PASSWORD');
    expect((await chg('PAYPAY123', 'newpass456')).status).toBe(200);
    await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'pay@gmail.com', password: 'PAYPAY123' }).expect(401);
    await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'pay@gmail.com', password: 'newpass456' }).expect(200);
    expect((await chg('newpass456', 'PAYPAY123')).status).toBe(200); // back, for the other tests
    await request(app).post('/api/auth/forgot-password').set('Origin', ORIGIN).send({ email: 'pay@gmail.com' }).expect(200);
    const payUser = await prisma.user.findUnique({ where: { email: 'pay@gmail.com' } });
    expect(await prisma.passwordResetToken.count({ where: { userId: payUser.id } })).toBe(0);
    await client.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'roles@example.com', password: 'secret123' }).expect(200); // (blocking signed the client out)
    expect((await client.get('/api/admin/stats')).status).toBe(403);
    expect((await pay.get('/api/auth/me')).body.user.role).toBe('PAYMENTS');
  });

  it('email log: the main admin sees every attempt and can send a test email', async () => {
    const main = await adminAgent();
    const test = await main.post('/api/admin/emails/test').set('Origin', ORIGIN).send({ to: 'someone@example.com' }).expect(200);
    expect(test.body.result.provider).toBe('console'); // no SMTP / Brevo in the tests
    expect(test.body.result.ok).toBe(false);
    expect((await main.post('/api/admin/emails/test').set('Origin', ORIGIN).send({ to: 'nope' })).status).toBe(400);
    const log = (await main.get('/api/admin/emails')).body;
    expect(log.provider).toBe('console');
    expect(log.logs[0]).toMatchObject({ to: 'someone@example.com', subject: 'Test email from STAR PRODUCTION', provider: 'console' });
  });
  it('upgrade payment: QR screenshot → admin confirms → plan switches; rejection lets the client pay again', async () => {
    const { loadPlans } = await import('../src/lib/plans.js');
    for (const [i, p] of loadPlans().entries()) {
      const data = { name: p.name, price: p.price, originalPrice: p.originalPrice, description: p.description, features: JSON.stringify(p.features), finalOutput: p.finalOutput, sortOrder: i };
      await prisma.plan.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
    }
    const agent = request.agent(app);
    await agent.post('/api/auth/signup').set('Origin', ORIGIN).send({ name: 'Pay Up', email: 'payup@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210' }).expect(201);
    await prisma.user.updateMany({ where: { email: 'payup@example.com' }, data: { emailVerifiedAt: new Date() } });
    const id = (await agent.post('/api/orders').set('Origin', ORIGIN).send({ planId: 'creator' }).expect(201)).body.order.id;
    await prisma.order.update({ where: { id }, data: { status: 'PAID', stage: 'PROJECT_ACTIVE' } });
    const admin = await adminAgent();

    const payAdmin = await payAdminAgent();
    const revenueBefore = (await admin.get('/api/admin/stats')).body.stats.totalRevenue;
    const uid = (await agent.post(`/api/orders/${id}/upgrade`).set('Origin', ORIGIN).send({ planId: 'studio' }).expect(200)).body.upgrade.id; // ₹300 more
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const proof = (b = {}) => agent.post(`/api/orders/upgrades/${uid}/payment-proof`).set('Origin', ORIGIN).send({ screenshot: png, reference: 'UTR-UP', ...b });

    expect((await agent.get(`/api/orders/upgrades/${uid}`)).body.upgrade).toMatchObject({ amount: 300, status: 'CREATED' });
    expect((await proof({ screenshot: 'nope' })).status).toBe(400);
    expect((await proof()).status).toBe(201);
    expect((await proof()).body.error.code).toBe('ALREADY_SUBMITTED');
    expect((await agent.post(`/api/orders/${id}/upgrade`).set('Origin', ORIGIN).send({ planId: 'signature' })).body.error.code).toBe('UPGRADE_IN_PROGRESS');
    expect((await agent.get(`/api/orders/upgrades/${uid}/proof`)).headers['content-type']).toBe('image/png');

    // The admin sees it among the payment requests (counted, with a screenshot).
    expect((await admin.get('/api/admin/stats')).body.stats.paymentRequests).toBe(1);
    const row = (await admin.get('/api/admin/payments')).body.payments.find((p) => p.kind === 'UPGRADE');
    expect(row).toMatchObject({ id: uid, status: 'PENDING', amount: 300, reference: 'UTR-UP', order: { plan: 'Upgrade: The Creator → The Studio' } });
    expect((await admin.get(row.screenshotUrl)).headers['content-type']).toBe('image/png');
    expect((await agent.post(`/api/admin/upgrades/${uid}/approve`).set('Origin', ORIGIN).send({})).status).toBe(403);

    // Reject → reason shown, can pay again.
    expect((await payAdmin.post(`/api/admin/upgrades/${uid}/reject`).set('Origin', ORIGIN).send({ reason: '' })).status).toBe(400);
    await payAdmin.post(`/api/admin/upgrades/${uid}/reject`).set('Origin', ORIGIN).send({ reason: 'Amount does not match' }).expect(200);
    expect((await agent.get(`/api/orders/${id}/status`)).body.order.upgrade).toMatchObject({ status: 'FAILED', note: 'Amount does not match' });
    expect((await proof({ reference: 'UTR-2' })).status).toBe(201);

    // Confirm → the order is the Studio now, still paid; revenue includes the upgrade.
    await payAdmin.post(`/api/admin/upgrades/${uid}/approve`).set('Origin', ORIGIN).send({}).expect(200);
    expect((await payAdmin.post(`/api/admin/upgrades/${uid}/approve`).set('Origin', ORIGIN).send({})).status).toBe(409);
    const after = (await agent.get(`/api/orders/${id}/status`)).body.order;
    expect(after).toMatchObject({ status: 'PAID', amount: 849, plan: { id: 'studio' }, upgrade: null });
    const afterStats = (await admin.get('/api/admin/stats')).body.stats;
    expect(afterStats.paymentRequests).toBe(0);
    expect(afterStats.totalRevenue).toBe(revenueBefore + 300); // the upgrade payment counts as revenue

    // An unpaid upgrade can be cancelled.
    const again = (await agent.post(`/api/orders/${id}/upgrade`).set('Origin', ORIGIN).send({ planId: 'signature' }).expect(200)).body.upgrade;
    await agent.delete(`/api/orders/upgrades/${again.id}`).set('Origin', ORIGIN).expect(200);
    expect((await agent.get(`/api/orders/${id}/status`)).body.order.upgrade).toBeNull();
  });

  it('change password: needs the correct current password, informs the admin, signs out other devices', async () => {
    const a = request.agent(app), other = request.agent(app);
    const body = { name: 'Pw Changer', email: 'chg@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210' };
    await a.post('/api/auth/signup').set('Origin', ORIGIN).send(body).expect(201);
    await other.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'chg@example.com', password: 'secret123' }).expect(200); // a second device
    const change = (b) => a.post('/api/auth/change-password').set('Origin', ORIGIN).send(b);

    expect((await change({ currentPassword: 'wrongpass1', newPassword: 'newpass456', confirmPassword: 'newpass456' })).body.error.fields.currentPassword).toBe('Current password is wrong');
    expect((await change({ currentPassword: 'secret123', newPassword: 'short', confirmPassword: 'short' })).status).toBe(400);
    expect((await change({ currentPassword: 'secret123', newPassword: 'newpass456', confirmPassword: 'different1' })).body.error.fields.confirmPassword).toBe('Passwords do not match');
    expect((await change({ currentPassword: 'secret123', newPassword: 'secret123', confirmPassword: 'secret123' })).body.error.fields.newPassword).toMatch(/different/);
    expect(await prisma.chatMessage.count({ where: { sender: 'SYSTEM' } })).toBe(0); // failed attempts tell nobody

    expect((await change({ currentPassword: 'secret123', newPassword: 'newpass456', confirmPassword: 'newpass456' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200); // this device stays signed in
    expect((await other.get('/api/auth/me')).status).toBe(401); // the other one is signed out
    expect((await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'chg@example.com', password: 'secret123' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'chg@example.com', password: 'newpass456' })).status).toBe(200);

    // The admin is informed (a notice in Messages, counted as unread); the client does not see it in their inbox.
    const admin = await adminAgent();
    const conv = (await admin.get('/api/admin/messages?email=chg@example.com')).body.conversations[0];
    expect(conv.unread).toBe(1);
    expect(conv.messages[0]).toMatchObject({ from: 'system', message: expect.stringMatching(/password/i) });
    expect((await admin.get('/api/admin/stats')).body.stats.unreadMessages).toBeGreaterThanOrEqual(1);
    expect((await a.get('/api/chat/inbox')).body.messages).toHaveLength(0);

    // The admin account needs its current password too, and a login is required.
    expect((await admin.post('/api/auth/change-password').set('Origin', ORIGIN).send({ currentPassword: 'not-the-one1', newPassword: 'newpass456', confirmPassword: 'newpass456' })).body.error.code).toBe('WRONG_PASSWORD');
    expect((await request(app).post('/api/auth/change-password').set('Origin', ORIGIN).send({})).status).toBe(401);
  });
  it('never creates a password-reset link for the admin account (the admin address may be anyone\'s mailbox)', async () => {
    await adminAgent();
    const res = await request(app).post('/api/auth/forgot-password').set('Origin', ORIGIN).send({ email: 'admin@gmail.com' });
    expect(res.status).toBe(200); // same neutral answer as for any address
    const admin = await prisma.user.findUnique({ where: { email: 'admin@gmail.com' } });
    expect(await prisma.passwordResetToken.count({ where: { userId: admin.id } })).toBe(0);
  });

  it('attaches a logged-in client automatically (no email needed)', async () => {
    const agent = request.agent(app);
    const signup = await agent.post('/api/auth/signup').set('Origin', ORIGIN).send({
      name: 'Chat Client', email: 'chatclient@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210',
    });
    expect(signup.status).toBe(201);
    await agent.post('/api/chat/handoff').set('Origin', ORIGIN).send({ message: 'Logged in question' }).expect(200);
    const saved = await prisma.chatMessage.findFirst({ where: { message: 'Logged in question' } });
    expect(saved.email).toBe('chatclient@example.com');
    expect(saved.name).toBe('Chat Client');
    expect(saved.userId).toBeTruthy();
  });

  it('rejects empty and oversized messages', async () => {
    expect((await send('   ')).status).toBe(400);
    expect((await send('x'.repeat(1001))).status).toBe(400);
  });

  it('lists popular questions', async () => {
    const res = await request(app).get('/api/chat/faqs');
    expect(res.status).toBe(200);
    expect(res.body.popular.length).toBeGreaterThan(0);
  });
});
