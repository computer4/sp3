// Discount codes: NEW-STAR (15%, first order only) and referral codes (10% for the friend, a 10% reward for the referrer once paid).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const ORIGIN = 'http://localhost:4000';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let app, prisma, hashPassword, discounts, invoice;

beforeAll(async () => {
  ({ createApp: app } = await import('../src/app.js'));
  app = app();
  ({ prisma } = await import('../src/lib/prisma.js'));
  ({ hashPassword } = await import('../src/lib/password.js'));
  discounts = await import('../src/lib/discounts.js');
  invoice = await import('../src/services/email/invoice.js');
});

const post = (agent, path, body) => agent.post(path).set('Origin', ORIGIN).send(body ?? {});
const patch = (agent, path, body) => agent.patch(path).set('Origin', ORIGIN).send(body ?? {});

async function client(tag) {
  const email = `${tag}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const agent = request.agent(app);
  const res = await post(agent, '/api/auth/signup', { name: `Artist ${tag}`, email, password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210' });
  expect(res.status).toBe(201);
  await prisma.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
  if (res.body.needsVerification) expect((await post(agent, '/api/auth/login', { email, password: 'secret123' })).status).toBe(200);
  return { agent, email, id: res.body.user.id };
}
async function staff(role, email) {
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.user.create({ data: { name: role, email, mobile: '', role, passwordHash: await hashPassword('STAFFPASS123'), emailVerifiedAt: new Date() } });
  }
  const agent = request.agent(app);
  expect((await post(agent, '/api/auth/login', { email, password: 'STAFFPASS123' })).status).toBe(200);
  return agent;
}

describe('discount codes', () => {
  it('prices are worked out on the server with whole rupees', () => {
    expect(discounts.priceAfter(549, 15)).toBe(467);
    expect(discounts.priceAfter(549, 10)).toBe(494);
    expect(discounts.priceAfter(849, 0)).toBe(849);
  });

  it('NEW-STAR: 15% off the first order only, any case, and the browser cannot choose the price', async () => {
    const a = await client('first');
    const check = await post(a.agent, '/api/orders/check-code', { code: ' new-star ', planId: 'creator' });
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ discount: { percent: 15, code: 'NEW-STAR', kind: 'NEW_STAR' }, amount: 467 });
    expect((await post(a.agent, '/api/orders/check-code', { code: 'NOPE-123' })).body.error.code).toBe('INVALID_CODE');

    // a price / percent sent by the browser is ignored
    const res = await post(a.agent, '/api/orders', { planId: 'creator', code: 'new-star', amount: 1, discountPercent: 90 });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ amount: 467, discount: { percent: 15, code: 'NEW-STAR', listPrice: 549, saved: 82 } });

    // not on a later order: complete the first one, then try again
    await prisma.order.update({ where: { id: res.body.order.id }, data: { stage: 'COMPLETED', workState: 'COMPLETED' } });
    const again = await post(a.agent, '/api/orders/check-code', { code: 'NEW-STAR', planId: 'creator' });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toMatch(/first order only/i);
    expect((await post(a.agent, '/api/orders', { planId: 'creator', code: 'NEW-STAR' })).status).toBe(400);
    expect((await post(a.agent, '/api/orders', { planId: 'creator' })).body.order.amount).toBe(549); // no code → full price
  });

  it('referral: friend gets 10% now, the referrer earns a 10% reward once the friend has paid (and uses it once)', async () => {
    const alice = await client('alice'), bob = await client('bob');
    const main = await staff('ADMIN', 'disc-main@example.com'), pays = await staff('PAYMENTS', 'disc-pay@example.com');

    const info = (await alice.agent.get('/api/orders/referral').set('Origin', ORIGIN)).body.referral;
    expect(info.code).toMatch(/^STAR-[A-Z2-9]{6}$/);
    expect(info).toMatchObject({ percent: 10, rewardCredits: 0, friends: 0, earned: 0 });
    expect((await alice.agent.get('/api/orders/referral').set('Origin', ORIGIN)).body.referral.code).toBe(info.code); // stable

    // not your own code, not a made-up one
    expect((await post(alice.agent, '/api/orders/check-code', { code: info.code })).body.error.message).toMatch(/own referral code/i);
    expect((await post(bob.agent, '/api/orders/check-code', { code: 'STAR-ZZZZZZ' })).body.error.code).toBe('INVALID_CODE');

    const order = (await post(bob.agent, '/api/orders', { planId: 'studio', code: info.code.toLowerCase() })).body.order;
    expect(order).toMatchObject({ amount: 764, discount: { percent: 10, kind: 'REFERRAL', listPrice: 849 } });
    expect((await alice.agent.get('/api/orders/referral').set('Origin', ORIGIN)).body.referral).toMatchObject({ friends: 1, earned: 0, rewardCredits: 0 });

    // plan switch before payment keeps the discount
    const sw = await post(bob.agent, `/api/orders/${order.id}/upgrade`, { planId: 'creator' });
    expect(sw.body.order).toMatchObject({ amount: 494, discount: { percent: 10, listPrice: 549 } });

    // the admin asks for payment, bob pays the discounted price, the payments admin confirms
    expect((await patch(main, `/api/admin/orders/${order.id}`, { stage: 'PAYMENT_PENDING' })).status).toBe(200);
    const proof = await post(bob.agent, `/api/orders/${order.id}/payment-proof`, { screenshot: PNG, reference: 'UTR1' });
    expect(proof.status).toBe(201);
    expect(proof.body.order.payment.amount).toBe(494);
    const payment = (await pays.get('/api/admin/payments').set('Origin', ORIGIN)).body.payments.find((p) => p.order?.id === order.id);
    expect((await post(pays, `/api/admin/payments/${payment.id}/approve`)).status).toBe(200);

    // alice earned the reward — once
    expect((await alice.agent.get('/api/orders/referral').set('Origin', ORIGIN)).body.referral).toMatchObject({ friends: 1, earned: 1, rewardCredits: 1 });
    expect((await post(pays, `/api/admin/payments/${payment.id}/approve`)).status).toBe(409);
    expect((await prisma.user.findUnique({ where: { id: alice.id } })).rewardCredits).toBe(1);

    // the reward applies by itself to alice's next plan (no code), and is used up
    const preview = await post(alice.agent, '/api/orders/check-code', { code: '', planId: 'signature' });
    expect(preview.body).toMatchObject({ discount: { kind: 'REWARD', percent: 10 }, amount: 1349 });
    const next = (await post(alice.agent, '/api/orders', { planId: 'signature' })).body.order;
    expect(next).toMatchObject({ amount: 1349, discount: { kind: 'REWARD', percent: 10, listPrice: 1499 } });
    expect((await prisma.user.findUnique({ where: { id: alice.id } })).rewardCredits).toBe(0);

    // a friend's code can only be used once per client
    await prisma.order.update({ where: { id: order.id }, data: { stage: 'COMPLETED', workState: 'COMPLETED' } });
    expect((await post(bob.agent, '/api/orders/check-code', { code: info.code })).body.error.message).toMatch(/already used/i);
  });

  it('an upgrade after a discounted payment costs the discounted difference, and the invoice shows the discount', async () => {
    const a = await client('upg');
    const main = await staff('ADMIN', 'disc-main@example.com'), pays = await staff('PAYMENTS', 'disc-pay@example.com');
    const order = (await post(a.agent, '/api/orders', { planId: 'creator', code: 'NEW-STAR' })).body.order; // 467
    await patch(main, `/api/admin/orders/${order.id}`, { stage: 'PAYMENT_PENDING' });
    await post(a.agent, `/api/orders/${order.id}/payment-proof`, { screenshot: PNG });
    const pay = (await pays.get('/api/admin/payments').set('Origin', ORIGIN)).body.payments.find((p) => p.order?.id === order.id);
    await post(pays, `/api/admin/payments/${pay.id}/approve`);

    const full = await prisma.order.findUnique({ where: { id: order.id }, include: { user: true, plan: true, payment: true } });
    const inv = invoice.invoiceForOrder(full);
    expect(inv.items[0].amount).toBe(549);
    expect(inv.discount).toMatchObject({ amount: 82, label: 'NEW-STAR (15% off)' });
    expect(invoice.invoiceTotal(inv)).toBe(467);
    expect(invoice.invoiceMail(inv).text).toMatch(/Discount: NEW-STAR \(15% off\) - ₹82/);

    const up = await post(a.agent, `/api/orders/${order.id}/upgrade`, { planId: 'studio' }); // 849 → 722 after 15%; difference 255
    expect(up.body).toMatchObject({ requested: true, remaining: 722 - 467 });
    await post(a.agent, `/api/orders/upgrades/${up.body.upgrade.id}/payment-proof`, { screenshot: PNG });
    expect((await post(pays, `/api/admin/upgrades/${up.body.upgrade.id}/approve`)).status).toBe(200);
    expect((await a.agent.get('/api/orders').set('Origin', ORIGIN)).body.orders[0]).toMatchObject({ amount: 722, plan: { id: 'studio' }, discount: { percent: 15, listPrice: 849 } });
  });
});
