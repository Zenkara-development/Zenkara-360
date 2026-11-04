/**
 * CLI entry point for seeding the demo/showcase org.
 *
 * Run:  cd server && npm run db:seed
 *
 * The actual seeding logic lives in src/utils/seedDemoData.ts so it can also
 * be called in-process by POST /api/demo/reset (the nightly automated
 * reset) without shelling out to this script.
 */

import 'dotenv/config'; // SEED_* logins come from server/.env
import { seedAllDemoOrgs } from '../src/utils/seedDemoData';
import { prisma } from '../src/utils/prisma';

seedAllDemoOrgs()
  .catch(e => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
