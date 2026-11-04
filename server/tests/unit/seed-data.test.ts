/**
 * Structural validation of the demo verticals.
 *
 * The demo data is sales collateral, not test fixtures — it is the first thing
 * a prospect sees. But it is also plain object literals with cross-references
 * by array index, and TypeScript cannot tell you that `contactIdx: 7` points
 * past the end of a six-element array, or that a deal's `stage` isn't one of
 * the pipeline's own stage labels.
 *
 * That second one had already gone wrong: a TechCorp deal used the stage
 * "Trial", which is not in its pipeline, so it rendered in no kanban column at
 * all. These tests exist so that class of bug is caught by `npm run test:unit`
 * rather than by someone noticing a deal missing during a demo.
 *
 * No database needed — this only inspects the exported preset objects.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { VERTICALS, DEMO_VERTICAL_SLUGS, DEFAULT_VERTICAL, loginEmailFor } from '../../src/utils/seedDemoData';

/** Ticket categories buildOrg actually creates. A preset referencing anything else silently gets a null category. */
const CATEGORIES = [
  'Hardware',
  'Software',
  'Network & Connectivity',
  'Access & Permissions',
  'Billing & Accounts',
];

test('every vertical has a unique slug', () => {
  const slugs = VERTICALS.map(v => v.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate vertical slugs');
});

test('the default vertical exists', () => {
  assert.ok(
    VERTICALS.some(v => v.slug === DEFAULT_VERTICAL),
    `DEFAULT_VERTICAL "${DEFAULT_VERTICAL}" is not in VERTICALS`
  );
});

test('every vertical resolves a demo login address', () => {
  for (const slug of DEMO_VERTICAL_SLUGS) {
    const email = loginEmailFor(slug);
    assert.match(email, /^admin@\S+\.\S+$/, `bad demo login for ${slug}: ${email}`);
  }
});

test('the techcorp login domain is unchanged — the whole e2e suite hardcodes it', () => {
  // tests/e2e/role-login, rbac, rbac-ui, security, pagination and
  // refresh-token all log in as admin@crmitdesk.com. Changing this domain
  // breaks that entire suite, so it is asserted rather than assumed.
  assert.equal(loginEmailFor('techcorp'), 'admin@crmitdesk.com');
});

for (const v of VERTICALS) {
  test(`[${v.slug}] contacts reference real accounts`, () => {
    v.contacts.forEach((c, i) => {
      assert.ok(v.accounts[c.accountIdx], `contacts[${i}].accountIdx ${c.accountIdx} is out of range`);
    });
  });

  test(`[${v.slug}] deals reference real contacts, accounts and pipeline stages`, () => {
    const stageLabels = v.stages.map(s => s.label);
    v.deals.forEach((d, i) => {
      assert.ok(v.contacts[d.contactIdx], `deals[${i}].contactIdx ${d.contactIdx} is out of range`);
      assert.ok(v.accounts[d.accountIdx], `deals[${i}].accountIdx ${d.accountIdx} is out of range`);
      assert.ok(
        stageLabels.includes(d.stage),
        `deals[${i}].stage "${d.stage}" is not a stage in this pipeline — it will render in no kanban column. Valid: ${stageLabels.join(', ')}`
      );
    });
  });

  test(`[${v.slug}] every pipeline has exactly one won and one lost stage`, () => {
    assert.equal(v.stages.filter(s => s.isWon).length, 1, 'expected exactly one won stage');
    assert.equal(v.stages.filter(s => s.isLost).length, 1, 'expected exactly one lost stage');
  });

  test(`[${v.slug}] leads reference real contacts and carry believable follow-ups`, () => {
    v.leads.forEach((l, i) => {
      assert.ok(v.contacts[l.contactIdx], `leads[${i}].contactIdx ${l.contactIdx} is out of range`);
      assert.ok(Array.isArray(l.followUps), `leads[${i}] has no followUps array`);
      // A disqualified lead legitimately has nothing scheduled. Any other
      // status with an empty list is a lead that looks abandoned in the demo.
      if (String(l.status) !== 'UNQUALIFIED') {
        assert.ok(l.followUps.length > 0, `leads[${i}] is ${l.status} but has no follow-ups`);
      }
    });
  });

  test(`[${v.slug}] tickets and articles use categories that get created`, () => {
    v.tickets.forEach((t, i) => {
      assert.ok(CATEGORIES.includes(t.category), `tickets[${i}].category "${t.category}" is never created`);
    });
    v.kb.forEach((k, i) => {
      assert.ok(CATEGORIES.includes(k.category), `kb[${i}].category "${k.category}" is never created`);
    });
  });

  test(`[${v.slug}] the custom module is internally consistent`, () => {
    const keys = v.customModule.fields.map(f => f.fieldKey);
    assert.equal(new Set(keys).size, keys.length, 'duplicate fieldKey in the custom module');
    assert.equal(
      v.customModule.fields.filter(f => f.isPrimary).length,
      1,
      'a custom module needs exactly one isPrimary field'
    );

    v.customModule.records.forEach((r, i) => {
      for (const key of Object.keys(r)) {
        assert.ok(keys.includes(key), `records[${i}] sets "${key}", which is not a declared field`);
      }
      for (const f of v.customModule.fields) {
        if (f.required) {
          assert.notEqual(r[f.fieldKey], undefined, `records[${i}] is missing required field "${f.fieldKey}"`);
        }
        if (f.fieldType === 'DROPDOWN' && r[f.fieldKey] !== undefined) {
          assert.ok(
            f.options?.includes(r[f.fieldKey] as string),
            `records[${i}].${f.fieldKey} = "${r[f.fieldKey]}" is not one of [${(f.options ?? []).join(', ')}]`
          );
        }
      }
    });
  });

  test(`[${v.slug}] the date automation targets a real DATE field with real data`, () => {
    const field = v.customModule.fields.find(f => f.fieldKey === v.dateAutomation.dateField);
    assert.ok(field, `dateAutomation.dateField "${v.dateAutomation.dateField}" is not a field on the custom module`);
    assert.equal(field!.fieldType, 'DATE', `dateAutomation targets a ${field!.fieldType} field, not a DATE`);

    // Without at least one record carrying that date, the automation exists but
    // never fires — so the demo silently shows nothing.
    const withDate = v.customModule.records.filter(r => r[v.dateAutomation.dateField] !== undefined);
    assert.ok(
      withDate.length > 0,
      `no record has a "${v.dateAutomation.dateField}" value, so this automation will never fire in the demo`
    );
  });

  test(`[${v.slug}] has enough data to look like a real business`, () => {
    // Thin demo data reads as an empty product. These floors are what the
    // existing verticals already meet.
    assert.ok(v.accounts.length >= 3, 'expected at least 3 accounts');
    assert.ok(v.contacts.length >= 5, 'expected at least 5 contacts');
    assert.ok(v.deals.length >= 5, 'expected at least 5 deals');
    assert.ok(v.tickets.length >= 5, 'expected at least 5 tickets');
    assert.ok(v.kb.length >= 3, 'expected at least 3 knowledge articles');
    assert.ok(
      v.deals.some(d => String(d.status) === 'WON'),
      'a pipeline with no won deal has no revenue to show'
    );
  });
}

test('real estate is present, priced in rupees, and property-shaped', () => {
  const realty = VERTICALS.find(v => v.slug === 'zenith-realty');
  assert.ok(realty, 'the real-estate vertical is missing');
  assert.equal(realty!.currency, 'INR', 'a property demo priced in dollars reads as a foreign product');
  assert.equal(realty!.timezone, 'Asia/Kolkata');
  assert.ok(
    realty!.stages.some(s => /site visit/i.test(s.label)),
    'a property pipeline without a site-visit stage is not a property pipeline'
  );
  // Sanity-check the money: crore-scale, not SaaS-scale.
  assert.ok(
    realty!.deals.every(d => d.value >= 1_000_000),
    'property deal values look too small for the Indian market'
  );
});

test('verticals that set a currency also set a timezone, and vice versa', () => {
  for (const v of VERTICALS) {
    assert.equal(
      v.currency === undefined,
      v.timezone === undefined,
      `[${v.slug}] sets one of currency/timezone but not the other — dates and money should agree on a locale`
    );
  }
});
