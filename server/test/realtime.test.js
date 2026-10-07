import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

const ORIGIN = 'http://localhost:4000';
let app, server, port, prisma, hashPassword;

beforeAll(async () => {
  ({ prisma } = await import('../src/lib/prisma.js'));
  ({ hashPassword } = await import('../src/lib/password.js'));
  const { createApp } = await import('../src/app.js');
  app = createApp();
  server = http.createServer(app).listen(0);
  port = server.address().port;
});
afterAll(() => server.close());

const cookieOf = (res) => res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');

/** Opens the live stream and returns helpers to wait for the next signal. */
async function openStream(cookie) {
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie }, signal: ctrl.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const next = async (needle, ms = 3000) => {
    const end = Date.now() + ms;
    while (!buf.includes(needle)) {
      if (Date.now() > end) throw new Error(`timed out waiting for "${needle}" (got: ${JSON.stringify(buf)})`);
      const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), 200))]);
      if (chunk.value) buf += dec.decode(chunk.value);
    }
    buf = buf.slice(buf.indexOf(needle) + needle.length);
  };
  return { next, close: () => ctrl.abort(), clear: () => (buf = '') };
}

describe('real-time updates', () => {
  it('rejects the stream without a login', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(res.status).toBe(401);
  });

  it('pushes an update to the admin when a client messages the team, and to the client when the admin replies', async () => {
    await prisma.user.deleteMany({ where: { email: { in: ['admin@gmail.com', 'live@example.com'] } } });
    await prisma.user.create({ data: { name: 'Admin', email: 'admin@gmail.com', mobile: '', role: 'ADMIN', passwordHash: await hashPassword('ADMIN') } });

    const adminLogin = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'admin@gmail.com', password: 'ADMIN' }).expect(200);
    const clientSignup = await request(app).post('/api/auth/signup').set('Origin', ORIGIN).send({
      name: 'Live Client', email: 'live@example.com', password: 'secret123', confirmPassword: 'secret123', mobile: '9876543210',
    }).expect(201);

    const adminStream = await openStream(cookieOf(adminLogin));
    const clientStream = await openStream(cookieOf(clientSignup));
    await adminStream.next(': connected');
    await clientStream.next(': connected');
    adminStream.clear();
    clientStream.clear();

    // Client writes to the team → the admin's page is told.
    await request(app).post('/api/chat/inbox').set('Cookie', cookieOf(clientSignup)).set('Origin', ORIGIN).send({ message: 'Hello team' }).expect(200);
    await adminStream.next('event: update');

    // Admin replies → the client's page is told.
    clientStream.clear();
    await request(app).post('/api/admin/messages/reply').set('Cookie', cookieOf(adminLogin)).set('Origin', ORIGIN)
      .send({ email: 'live@example.com', message: 'Hi there' }).expect(201);
    await clientStream.next('event: update');

    adminStream.close();
    clientStream.close();
  });
});
