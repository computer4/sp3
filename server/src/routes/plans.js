import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { toPublicPlan } from '../lib/serialize.js';

const router = Router();

router.get('/', async (req, res) => {
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ plans: plans.map(toPublicPlan) });
});

export default router;
