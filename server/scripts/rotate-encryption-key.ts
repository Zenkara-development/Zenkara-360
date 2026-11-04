/**
 * Re-encrypts every value stored with encryptSecret() from an old
 * ENCRYPTION_KEY to a new one — connected mailbox passwords, platform
 * Resend/SMTP/Twilio/S3 secrets, per-org S3 keys and Drive tokens, Entra
 * client secrets, AI provider keys and the employee bank/tax columns.
 *
 *     OLD_ENCRYPTION_KEY=<old> ENCRYPTION_KEY=<new> npm run rotate:encryption-key              # dry run
 *     OLD_ENCRYPTION_KEY=<old> ENCRYPTION_KEY=<new> npm run rotate:encryption-key -- --apply
 *
 * Columns are discovered from the Prisma schema rather than listed by hand,
 * so a column added later is not silently missed: every non-list String
 * column is scanned for the "v1:" ciphertext prefix, and a value is rewritten
 * only if it actually decrypts with the OLD key. Plain-text lookalikes are
 * never touched, and re-running after an interrupted or completed apply is
 * safe — values already on the new key are counted and skipped.
 *
 * Order: stop the API, back up the database, run with --apply, put the new
 * ENCRYPTION_KEY in the server env, start the API.
 */
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { encryptSecret, decryptSecret } from '../src/utils/crypto';

// Shell variables win over server/.env (dotenv never overrides), so the new
// key can be passed inline without editing .env first.
dotenv.config();

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const oldKey = process.env.OLD_ENCRYPTION_KEY;
  const newKey = process.env.ENCRYPTION_KEY;
  if (!oldKey || !newKey) {
    console.error('Set both OLD_ENCRYPTION_KEY (current key) and ENCRYPTION_KEY (new key).');
    process.exit(1);
  }
  if (oldKey === newKey) {
    console.error('OLD_ENCRYPTION_KEY and ENCRYPTION_KEY are identical — nothing to rotate.');
    process.exit(1);
  }

  console.log(apply ? '\nAPPLY — values will be rewritten\n' : '\nDRY RUN — nothing is written (add -- --apply to rewrite)\n');
  let rotated = 0;
  let alreadyNew = 0;
  let unreadable = 0;

  for (const model of Prisma.dmmf.datamodel.models) {
    const idField = model.fields.find(f => f.isId);
    const columns = model.fields.filter(f => f.kind === 'scalar' && f.type === 'String' && !f.isList);
    if (!idField || !columns.length) continue;
    const delegate = (prisma as any)[model.name.charAt(0).toLowerCase() + model.name.slice(1)];

    for (const col of columns) {
      const rows: Record<string, string>[] = await delegate.findMany({
        where: { [col.name]: { startsWith: 'v1:' } },
        select: { [idField.name]: true, [col.name]: true },
      });
      let count = 0;
      for (const row of rows) {
        const stored = row[col.name];
        let plaintext: string;
        try {
          plaintext = decryptSecret(stored, oldKey);
        } catch {
          try {
            decryptSecret(stored, newKey);
            alreadyNew++;
          } catch {
            unreadable++;
            console.warn(`  ! ${model.name}.${col.name} id=${row[idField.name]} decrypts with neither key — left as is`);
          }
          continue;
        }
        if (apply) {
          await delegate.update({
            where: { [idField.name]: row[idField.name] },
            data: { [col.name]: encryptSecret(plaintext, newKey) },
          });
        }
        count++;
      }
      if (count) console.log(`  ${model.name}.${col.name}: ${count}`);
      rotated += count;
    }
  }

  console.log(`\n${apply ? 'Rotated' : 'Would rotate'}: ${rotated}   already on new key: ${alreadyNew}   unreadable: ${unreadable}`);
  if (!apply && rotated) console.log('Re-run with -- --apply to rewrite them.');
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
