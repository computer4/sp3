import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const plansFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/plans.js');

/** Loads data/plans.js — the same file index.html uses — with basic sanity checks. */
export function loadPlans() {
  delete require.cache[plansFile];
  const plans = require(plansFile);
  if (!Array.isArray(plans) || !plans.length) throw new Error('data/plans.js must export a non-empty array');
  for (const p of plans) {
    if (!/^[\w-]{1,50}$/.test(p.id ?? '')) throw new Error(`Invalid plan id: ${p.id}`);
    if (!(Number(p.price) > 0)) throw new Error(`Plan ${p.id} needs a positive price`);
    if (p.originalPrice != null && !(Number(p.originalPrice) > Number(p.price))) {
      throw new Error(`Plan ${p.id}: originalPrice must be higher than price`);
    }
  }
  return plans;
}
