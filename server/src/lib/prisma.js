import { PrismaClient } from '@prisma/client';
import { publish } from './events.js';

// Every change to these tables tells the connected pages (dashboards, admin panel) to refresh — that is
// what makes the site update in real time, with no per-route bookkeeping to forget.
const WATCHED = new Set(['Order', 'Payment', 'Upgrade', 'ChatMessage', 'User']);
const WRITES = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

function recipients(model, result) {
  const one = result && !Array.isArray(result) && typeof result === 'object' && !('count' in result) ? result : null;
  if (!one) return 'all'; // bulk change: every page re-reads its own data
  if (model === 'User') return [one.id];
  if (model === 'Order') return [one.userId];
  if (model === 'ChatMessage') return one.userId ? [one.userId] : []; // a guest's message only concerns the admin
  return 'all'; // payments / upgrades: the owner is not on the row
}

function create() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args);
          if (WATCHED.has(model) && WRITES.has(operation)) publish({ admin: true, users: recipients(model, result) });
          return result;
        },
      },
    },
  });
}

// One shared client per process (reused across hot reloads in development).
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.__starPrisma ?? create();

if (process.env.NODE_ENV !== 'production') globalForPrisma.__starPrisma = prisma;
