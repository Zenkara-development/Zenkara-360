/**
 * Run once before your first test run to ensure the admin account exists:
 *
 *   npx ts-node tests/helpers/seed-admin.ts
 *
 * Or use the REST API directly:
 *
 *   POST http://localhost:4000/api/auth/register
 *   { "name": "Admin User", "email": "admin@crmitdesk.com", "password": "Admin@123" }
 *
 * Then promote to SUPER_ADMIN via Prisma Studio:
 *   cd server && npx prisma studio
 *   → Users table → find admin@crmitdesk.com → set role = SUPER_ADMIN
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@crmitdesk.com';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('✓ Admin user already exists');
    await prisma.user.update({ where: { email }, data: { role: 'SUPER_ADMIN' } });
    console.log('✓ Role confirmed as SUPER_ADMIN');
    return;
  }

  const passwordHash = await bcrypt.hash('Admin@123', 12);
  await prisma.user.create({
    data: {
      name: 'Admin User',
      email,
      passwordHash,
      role: 'SUPER_ADMIN',
    },
  });
  console.log('✓ Admin user created: admin@crmitdesk.com / Admin@123');
}

main().catch(console.error).finally(() => prisma.$disconnect());
