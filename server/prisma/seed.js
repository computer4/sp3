// Seeds the database (safe to run any number of times):
//   1. the 4 plans from data/plans.js (the same file the website uses)
//   2. the two staff accounts from .env — MAIN_ADMIN_* (main admin) and SIDE_ADMIN_* (payments admin)
//      (if a password is empty for a NEW account, a strong one is generated and printed ONCE)
import crypto from 'node:crypto';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { loadPlans } from '../src/lib/plans.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

async function seedPlans() {
  const plans = loadPlans();
  for (const [index, plan] of plans.entries()) {
    const data = {
      name: plan.name,
      price: Math.round(plan.price),
      originalPrice: plan.originalPrice ? Math.round(plan.originalPrice) : null,
      description: plan.description,
      features: JSON.stringify(plan.features),
      finalOutput: plan.finalOutput,
      isFeatured: Boolean(plan.isFeatured),
      sortOrder: index,
      active: true,
    };
    await prisma.plan.upsert({ where: { id: plan.id }, update: data, create: { id: plan.id, ...data } });
    console.log(`✓ Plan ${plan.name} — ₹${plan.price}${plan.originalPrice ? ` (was ₹${plan.originalPrice})` : ''}`);
  }
  // Plans removed from data/plans.js are deactivated, not deleted (old orders reference them).
  await prisma.plan.updateMany({ where: { id: { notIn: plans.map((p) => p.id) } }, data: { active: false } });
}

const MIN_PROD_PASSWORD = 10;

/** Creates / updates one staff account. Returns the email if it is (now) configured. */
async function seedOne({ role, label, name, email, password }) {
  email = email?.trim().toLowerCase();
  if (!email) {
    console.log(`• No ${label} email in .env — skipping.`);
    return null;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  let generated = false;

  if (!password && !existing) {
    password = crypto.randomBytes(12).toString('base64url');
    generated = true;
  }
  if (password && password.length < MIN_PROD_PASSWORD && env.NODE_ENV === 'production') {
    // On a public website a short staff password is an open door: anyone could guess it.
    console.error(`✗ ${label} password is only ${password.length} characters. On the public site it must be at least ${MIN_PROD_PASSWORD}.`);
    console.error('  Set a stronger password in the host\'s environment settings and deploy again.');
    process.exitCode = 1;
    return email;
  }
  if (password && password.length < 12 && env.NODE_ENV !== 'production') {
    console.warn(`  ! ${label} password is short (${password.length} characters). Fine on this computer — use a long one before going online.`);
  }

  // An existing staff account keeps the password its owner chose in the admin panel. The password in the settings is used when the
  // account is created, or again when RESET_STAFF_PASSWORDS=true (forgot it? set that for one deploy, then remove it).
  if (existing && process.env.RESET_STAFF_PASSWORDS !== 'true') password = undefined;
  const sameAlready = existing && password ? await verifyPassword(existing.passwordHash, password) : Boolean(existing);
  if (existing && existing.role === role && existing.status === 'ACTIVE' && sameAlready && existing.emailVerifiedAt) {
    console.log(`✓ ${label}: ${email} (unchanged)`);
    return email;
  }

  const base = { role, status: 'ACTIVE', emailVerifiedAt: existing?.emailVerifiedAt ?? new Date(), ...(name ? { name } : {}) };
  const passwordHash = password && !sameAlready ? await hashPassword(password) : undefined;
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { ...base, ...(passwordHash ? { passwordHash } : {}) } })
    : await prisma.user.create({ data: { ...base, email, name: name || label, mobile: '', passwordHash } });
  if (passwordHash) await prisma.session.deleteMany({ where: { userId: user.id } }); // new password → sign out everywhere

  console.log(`✓ ${label}: ${email}`);
  if (generated) {
    console.log('');
    console.log('  ┌───────────────────────────────────────────────┐');
    console.log(`  │ ${label} password: ${password.padEnd(30)}│`);
    console.log('  │ Save it now — it will not be shown again.     │');
    console.log('  └───────────────────────────────────────────────┘');
    console.log('');
  }
  return email;
}

/**
 * The two official staff accounts:
 *   MAIN admin     — every client detail, projects, messages; cannot confirm payments
 *   PAYMENTS admin — payments (and confirming them), messages, the overview numbers
 * Any other staff account (for example the old default admin) is removed, so only these two can open the admin panel.
 */
async function seedStaff() {
  const keep = [];
  keep.push(await seedOne({
    role: 'ADMIN', label: 'Main admin', name: env.MAIN_ADMIN_NAME || env.ADMIN_NAME || 'Main Admin',
    email: env.MAIN_ADMIN_EMAIL || env.ADMIN_EMAIL, password: env.MAIN_ADMIN_PASSWORD || env.ADMIN_PASSWORD,
  }));
  keep.push(await seedOne({
    role: 'PAYMENTS', label: 'Payments admin', name: env.SIDE_ADMIN_NAME || 'Payments Admin',
    email: env.SIDE_ADMIN_EMAIL, password: env.SIDE_ADMIN_PASSWORD,
  }));
  const configured = keep.filter(Boolean);
  if (!configured.length) return;
  const stale = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'PAYMENTS'] }, email: { notIn: configured } }, select: { id: true, email: true } });
  for (const u of stale) {
    await prisma.user.delete({ where: { id: u.id } });
    console.log(`• Removed staff account ${u.email} (not one of the configured admins).`);
  }
}
async function main() {
  await seedPlans();
  await seedStaff();
}

main()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
