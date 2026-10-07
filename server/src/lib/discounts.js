// Discount rules (one place, so the checkout preview and the real order always agree):
//   NEW-STAR       15% off — first order only
//   referral code  10% off — a friend's code ("STAR-XXXXXX"); the friend then earns a 10% reward once this order is paid
//   reward         10% off — a reward earned by referring someone, applied automatically to the next order (when no code is entered)
// One discount per order — they never stack. The amount is always worked out here, never taken from the browser.
import crypto from 'node:crypto';
import { HttpError } from './errors.js';

export const NEW_STAR_CODE = 'NEW-STAR';
export const NEW_STAR_PERCENT = 15;
export const REFERRAL_PERCENT = 10;
export const REWARD_PERCENT = 10;

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I — easy to read out and type
const REFERRAL_SHAPE = /^STAR-[A-Z2-9]{6}$/;

/** Price after a percentage discount, in whole rupees. */
export const priceAfter = (price, percent) => Math.round((price * (100 - (percent || 0))) / 100);

export const normalizeCode = (raw) => String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');

const invalid = (message) => new HttpError(400, message, { code: 'INVALID_CODE', fields: { code: message } });

export function newReferralCode() {
  let s = '';
  for (const b of crypto.randomBytes(6)) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `STAR-${s}`;
}

/** The client's own referral code — created the first time it is needed. */
export async function ensureReferralCode(prisma, user) {
  if (user.referralCode) return user.referralCode;
  for (let i = 0; i < 8; i++) {
    try {
      const updated = await prisma.user.update({ where: { id: user.id }, data: { referralCode: newReferralCode() } });
      return updated.referralCode;
    } catch (err) {
      if (err?.code !== 'P2002') throw err; // a (very unlikely) clash — try another
    }
  }
  throw new HttpError(500, 'Could not create your referral code. Please try again.');
}

/**
 * Works out which discount an order gets (or throws a friendly "invalid code" error).
 * `rawCode` is whatever the client typed (may be empty). Returns null for no discount.
 */
export async function resolveDiscount(prisma, user, rawCode) {
  const code = normalizeCode(rawCode);
  const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, rewardCredits: true } });

  if (!code) {
    if ((fresh?.rewardCredits ?? 0) > 0) {
      return { percent: REWARD_PERCENT, code: 'REWARD', kind: 'REWARD', referrerId: null, label: 'Referral reward' };
    }
    return null;
  }

  // Orders that count as "used": anything not cancelled.
  const earlier = await prisma.order.findMany({ where: { userId: user.id, status: { not: 'CANCELLED' } }, select: { discountKind: true } });

  if (code === NEW_STAR_CODE) {
    if (earlier.length > 0) throw invalid('NEW-STAR works on your first order only.');
    return { percent: NEW_STAR_PERCENT, code: NEW_STAR_CODE, kind: 'NEW_STAR', referrerId: null, label: 'NEW-STAR first-order offer' };
  }

  if (REFERRAL_SHAPE.test(code)) {
    const owner = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true, role: true, status: true } });
    if (!owner || owner.role !== 'CLIENT' || owner.status !== 'ACTIVE') throw invalid('This code isn’t valid. Please check it and try again.');
    if (owner.id === user.id) throw invalid('You can’t use your own referral code — share it with a friend instead.');
    if (earlier.some((o) => o.discountKind === 'REFERRAL')) throw invalid('You have already used a referral code.');
    return { percent: REFERRAL_PERCENT, code, kind: 'REFERRAL', referrerId: owner.id, label: 'Friend’s referral code' };
  }

  throw invalid('This code isn’t valid. Please check it and try again.');
}

/** What the browser is shown for an order's discount. */
export const publicDiscount = (order) =>
  order.discountPercent
    ? { percent: order.discountPercent, code: order.discountCode, kind: order.discountKind, listPrice: order.listPrice ?? null, saved: order.listPrice != null ? order.listPrice - order.amount : null }
    : null;
