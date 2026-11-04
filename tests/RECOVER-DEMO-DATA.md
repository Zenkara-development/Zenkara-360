# Recovering your demo data and logins

## What went wrong

`buildOrg()` in `seedDemoData.ts` deletes an existing demo org **before** it
rebuilds it:

```ts
if (existing) {
  await prisma.organization.delete(...)   // ← org and all its data gone
  await prisma.user.deleteMany(...)       // ← logins gone
}
// ...then ~300 lines of rebuilding
```

Anything that throws during that rebuild leaves you with no org at all. That is
one bug with two symptoms: **logins stop working** *and* **demo data
disappears**, which is exactly what you saw.

The specific trigger was my change: the seed now creates employees, departments
and locations. Those tables only exist after `prisma migrate dev` has been run.
Seeding before migrating meant `prisma.employee.create` threw, the rebuild
aborted, and every demo org that had already been deleted was never recreated.

**Your real data was not affected.** This only touches orgs whose slug matches a
demo vertical.

## Fix it

```bash
cd C:\Projects\CRMITDesk\server

npx prisma migrate dev --name people_platform   # creates the new tables
npx prisma generate
npm run db:seed                                  # rebuilds all 8 demo orgs
```

If you have already run the migration, `npm run db:seed` on its own is enough.

Then verify — this should print `pass 129`:

```bash
npm run test:unit
```

## So it cannot happen again

**A preflight check before anything destructive.** The seed now probes for the
Employee table *before* deleting any org. If the migration hasn't run it prints
a clear warning and still builds a complete CRM/IT Desk demo — the HR module is
just empty for that run. Nothing gets deleted-and-not-rebuilt.

**The HR block is best-effort.** Employees, departments and the org chart are
now built in a separate `buildPeople()` function wrapped in try/catch. The
demo's essential output is working logins and a populated pipeline; the HR layer
is a bonus on top. A missing column can no longer cost you every demo account.

**70 new tests validate the demo data itself.** They run with `npm run test:unit`
and check every vertical for referential integrity — deals pointing at real
contacts, stages that exist in their own pipeline, ticket categories that
actually get created, custom-module records matching their declared fields.

That last one found a **pre-existing bug**, present long before this work: the
TechCorp deal *"Acme Cloud Migration"* had `stage: 'Trial'`, and `Trial` is not
in TechCorp's pipeline. That deal was rendering in no kanban column at all.
Fixed to `Demo Scheduled` (which matches its 45% probability). If you had ever
wondered why the TechCorp board looked light, that was why.

---

# The new demo vertical: real estate

**Zenith Realty Partners** — a Hyderabad-based property brokerage.

| | |
|---|---|
| Slug | `zenith-realty` |
| Login | `admin@zenith-realty.demo` / `Admin@123` |
| Currency | **INR** (₹) |
| Timezone | Asia/Kolkata |

## Why this one is in rupees

Every other vertical is USD/UTC and stays exactly that way. Real estate is the
vertical where the money is the demo: *"₹1.85 Cr, 3BHK, Tower B"* lands with an
Indian buyer in a way *"$220,000"* never will. I added optional `currency` and
`timezone` to the vertical preset — omitted means USD/UTC, so all seven existing
verticals are byte-identical to before.

If you would rather it were USD, it is a two-line change in the preset.

## What's in it

**Pipeline** — shaped like property sales, not SaaS:
Enquiry → Site Visit Scheduled → Negotiation → Booking Amount → Closed Won/Lost

**Accounts** — a residential developer, a commercial developer, and a corporate
leasing client (Aurelia Developers, Skyline Infra Projects, Nandan Corporate
Housing), with Hyderabad and Bengaluru addresses and real-format `+91` numbers.

**Deals** — ₹98 lakh to ₹4.2 crore, named the way property deals actually are:
*"Aurelia Heights — 3BHK Tower B, Unit 1204"*, *"Skyline Tech Park — 12,000 sq ft
office lease"*, *"Nandan Whitefield — 24-unit corporate lease renewal"*.

**Leads** — with the detail a broker would actually record: *"Wants a 3BHK in
Tower B, east-facing, above 10th floor. Home loan pre-approved with HDFC."*
AI scores are reasoned rather than arbitrary — 89 for a pre-approved buyer who
has already done a site visit, 41 for an unqualified web enquiry.

**Tickets** — IT problems a realty firm genuinely has: cost sheets not opening
on the site-office tablets, portal listings not syncing, biometric attendance
down at the Gachibowli site office, and a stamp-duty rate that's out of date on
the cost-sheet template — that last one with the consequence spelled out
("every quote generated this week is understated"), because a ticket without a
consequence doesn't demo urgency.

**Knowledge base** — generating a buyer cost sheet (stamp duty, GST, corpus
fund), the site-visit checklist, and channel-partner onboarding with RERA agent
numbers and quarterly access review.

**Custom module — Property Inventory** — unit-level stock across projects: unit
number, project, configuration, carpet area, asking price, status
(Available/Blocked/Booked/Registered) and possession date.

**Automation** — *Possession Handover Reminder*, firing 7 days before a unit's
possession date so the snag list and handover kit are ready. One unit is
deliberately 5 days out, so the automation is visibly live during a demo rather
than theoretically configured.

## All eight demo logins

Password for every account: `Admin@123`

| Industry | Org | Login |
|---|---|---|
| Technology / SaaS | TechCorp Solutions | `admin@crmitdesk.com` |
| Healthcare | Meridian Health Partners | `admin@meridian-health.demo` |
| Retail | Coastal Retail Group | `admin@coastal-retail.demo` |
| Financial Services | Summit Financial Partners | `admin@summit-financial.demo` |
| Manufacturing | IronForge Manufacturing | `admin@ironforge-mfg.demo` |
| Salon / Spa | Glow Salon & Spa Collective | `admin@glow-salon-spa.demo` |
| Automotive | Apex Auto Group | `admin@apex-auto-group.demo` |
| **Real Estate** | **Zenith Realty Partners** | **`admin@zenith-realty.demo`** |

Each also has `crm@`, `sales@`, `itmanager@` and `itagent@` at the same domain.

## Every demo org now has an HR module too

Previously a demo org had five users and an empty HR section. Now each one gets:

- **Three departments** — Operations, Sales, IT, each with a head assigned
- **An HQ location**
- **Six employees with a real reporting line** — Sam reports to Carla, Dave to
  Ivy, both managers to Alex. The org chart has something to draw.
- **Ravi Kumar, a Facilities Coordinator with no login at all** — a contractor.
  He is there on purpose: he is the case your old User-only model could not
  represent, and the fastest way to show in one screen why Employee is a
  separate entity from User.

Dave Desk is seeded as `PROBATION` rather than `ACTIVE`, so the employment-status
filter has something to filter.
