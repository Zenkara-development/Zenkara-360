# Active Directory & Microsoft Entra ID Integration — Implementation Plan

**Scope agreed:** support both Microsoft Entra ID (cloud) and on-prem Active Directory (LDAP/ADFS); deliver SSO login *and* automated user provisioning (group-to-role mapping, auto create/deactivate).

This plan is written against the current CRMITdesk Evolved codebase (Node/Express/Prisma/Postgres server, React/Vite client, JWT-based multi-tenant auth). It's meant to be reviewed and adjusted before any code is written.

---

## 1. Why this is two integrations, not one

"Active Directory" and "Entra ID" are often talked about together but they're different protocols talking to different places, and the plan has to treat them that way:

**Microsoft Entra ID** (formerly Azure AD) is a cloud identity service with modern APIs: OIDC/OAuth2 for sign-in, SAML as an alternative, and Microsoft Graph (plus optionally SCIM) for reading users and groups or having Microsoft push changes to us. Because it's cloud-to-cloud, CRMITdesk's server can talk to it directly over the public internet — no VPN, no network exposure required from the customer.

**On-prem Active Directory** has no public API. A SaaS app can only reach it through something the customer runs or exposes: ADFS (federates AD identities out as SAML/WS-Fed, so we'd talk to ADFS, not AD directly), a customer-hosted LDAP endpoint reachable from us (rare and a hard security sell for most IT departments), or — the path almost every SaaS vendor actually takes — the customer syncs their on-prem AD into Entra ID themselves using Microsoft's own **Entra Connect** tool, and we only ever integrate with Entra ID.

Recommendation: build the Entra ID integration as the primary, fully-featured path, and treat on-prem AD as a secondary path for customers who genuinely have no Entra ID tenant — via ADFS SAML for login and an optional customer-run LDAP sync agent for provisioning (detailed in section 6), rather than CRMITdesk making outbound LDAP connections into customer networks. This keeps the common case (Entra ID, likely 90%+ of prospects given Entra ID's huge installed base) clean and modern, while still giving on-prem-only customers a path that doesn't require them to expose their directory to the internet.

---

## 2. What "SSO + provisioning" means concretely

Two separate capabilities, both requested:

**Single sign-on** — an employee clicks "Sign in with Microsoft" (or is redirected there automatically if their org enforces SSO) instead of typing a CRMITdesk password. CRMITdesk never sees or stores their AD/Entra password; it receives a signed token proving who they are and issues its own session (reusing the existing JWT/refresh-token system — no changes needed there).

**Automated provisioning** — new employees added to the customer's AD/Entra ID automatically get a CRMITdesk account (and the right role) without an admin manually inviting them; employees removed from AD/Entra or from a mapped group are automatically deactivated in CRMITdesk. This is the harder, higher-value half of the ask, and it's what actually reduces the manual "add user to CRM tool" busywork that AD integration requests are usually about.

These are separable — SSO can ship without provisioning, and JIT provisioning (create-on-first-login) can ship before full sync-based provisioning. That separability is the basis for the phased plan in section 8.

---

## 3. Fit with the current codebase

A few things from the existing app shape this plan directly:

The **JWT session model doesn't need to change**. `authenticate.ts`'s `req.user = { id, role, email, orgId }` and the access/refresh token pair stay exactly as they are — an SSO login just becomes a new way to *arrive* at "issue this user a session," parallel to the password-login and Google-link code paths in `auth.controller.ts`.

There's **no existing OAuth redirect/callback flow** in this app. Slack/Teams integration is webhook-URL paste, and Google is a client-side ID-token verification, not a server-side authorization-code exchange. Entra ID OIDC is a real authorization-code-with-PKCE flow, so this is genuinely new plumbing: a `/auth/entra/login` redirect endpoint and a `/auth/entra/callback` endpoint that exchanges a code for tokens server-side. This is standard OIDC, not exotic, but it's worth flagging as new territory rather than "just like Google."

**Secret storage already exists and should be reused as-is**: `utils/crypto.ts`'s `encryptSecret`/`decryptSecret` (AES-256-GCM) is currently used only for mailbox passwords, but it's exactly what an Entra ID client secret or LDAP bind-account password needs.

**The org-scoped, admin-managed config model pattern already exists** (`SlackConfig`, `TeamsConfig` — one row per org, `requireRole(...IT_MANAGERS)`-gated CRUD, a settings page under an admin nav item). The new directory-integration config should follow this same shape rather than inventing a new pattern.

**Background jobs infrastructure already exists** (the app has a `background_jobs` migration and a Jobs admin page). Scheduled directory sync (polling Microsoft Graph, or an LDAP sync) should be built as a job type in that existing system rather than a bespoke cron setup.

**No relevant libraries are installed yet** — no `passport`, `@azure/msal-node`, `openid-client`, `jwks-rsa`, `samlify`/`passport-saml`, or `ldapjs`. All of these are new dependencies; see section 7.

---

## 4. Data model additions

New Prisma models, following the existing per-org-config convention:

**`DirectoryConfig`** (one per org, like `SlackConfig`): which integration type is active (`ENTRA_OIDC`, `ENTRA_SAML`, `ADFS_SAML`, `LDAP_SYNC`), Entra tenant ID / client ID, the client secret (via `encryptSecret`), SAML/ADFS metadata URL or certificate if applicable, LDAP host/bind DN/base DN/encrypted bind password if applicable, an `ssoEnforced` flag (block password login entirely once true), sync status fields (`lastSyncAt`, `lastSyncStatus`, `lastSyncError`) for surfacing health in the admin UI.

**`DirectoryRoleMapping`** (many per org): links an external group identifier (Entra security-group object ID, or an AD group DN) to a CRMITdesk `UserRole`, plus a priority/precedence field for when a user is in multiple mapped groups. This is what makes "automated provisioning" actually map to the right permissions instead of dumping everyone in as `EMPLOYEE`.

**`User` additions**: `externalDirectoryId` (Entra `oid`/`sub` or AD `objectGUID`, unique, nullable — same shape as the existing `googleId` field) and `provisionedVia` (`MANUAL`, `INVITE`, `DIRECTORY_SYNC`) so the UI/audit trail can show which accounts are directory-managed and warn an admin before they hand-edit or delete one that will just get re-synced.

**`DirectorySyncLog`** (optional but recommended): one row per sync run — counts of users created/updated/deactivated, errors — gives the admin UI something concrete to show ("last synced 4 minutes ago, 3 users added, 1 deactivated") instead of a black box, and gives support something to look at when a customer says "my new hire isn't showing up."

---

## 5. Entra ID track (primary path)

**Sign-in (OIDC, authorization code + PKCE).** Register CRMITdesk as a multi-tenant (or single-tenant-per-customer, see below) app in Microsoft Entra. `GET /auth/entra/login` redirects to Microsoft's `/authorize` endpoint; `GET /auth/entra/callback` exchanges the returned code for an ID token + access token, validates the ID token's signature against Microsoft's published JWKS (`jwks-rsa` + `jsonwebtoken`, or adopt `openid-client`/`@azure/msal-node` to handle discovery and validation instead of hand-rolling it — recommended over the Google-style hand-rolled approach, since OIDC has more moving parts: nonce/state validation, token expiry, issuer checks per-tenant). On success: look up `User` by `externalDirectoryId`; if found, log them in; if not found and JIT provisioning is enabled for the org, create the user (role from group mapping, falling back to a configurable default role); if not found and JIT is disabled, reject with a clear "your account hasn't been provisioned yet" error.

One important design decision to make explicit: **how do we know which org/tenant a login belongs to?** Unlike Google (any user, matched by email domain implicitly through the existing account), Entra SSO needs the org resolved *before* redirecting to Microsoft, because each customer org configures its own tenant ID. Two common approaches: a per-org login URL/subdomain the customer's employees bookmark (simplest, no new UI needed at the shared login page), or an email-domain-to-org lookup at the shared login page ("enter your work email" → look up which org's directory config matches that domain → redirect to that org's tenant). The email-domain approach is friendlier but needs a verified-domain field on `DirectoryConfig` and a bit more login-page work. This is a decision worth pinning down with you before building — it changes the login page, not just the backend.

**Group-based role mapping.** After validating the ID token, request the user's group memberships — either via the `groups` claim in the token (needs the app registration configured for group claims, has a 200-group overage caveat) or a follow-up Microsoft Graph `/me/memberOf` call using the access token. Match against `DirectoryRoleMapping` rows for the org, apply the highest-precedence match, update the user's role if it changed since last login.

**Provisioning/deprovisioning beyond JIT.** JIT only creates a user the first time they log in — it doesn't proactively deactivate someone the moment they're removed from AD, and it doesn't create an account before someone's first login (which some customers want, e.g. so a new hire's manager can assign tickets to them day one). Two complementary mechanisms: a **scheduled Graph sync** (a background job, e.g. every 15–60 minutes, pages through `/groups/{id}/members` for each mapped group per org, reconciles against CRMITdesk's user list — creates missing users, deactivates users no longer present) is the simpler of the two to build and fits the existing background-jobs system directly; **SCIM** (Entra ID pushes user/group changes to a CRMITdesk-hosted SCIM 2.0 endpoint in near-real-time) is the more "enterprise-grade" answer and what large customers will specifically ask for by name, but it's a meaningfully bigger build (a spec-compliant SCIM server, bearer-token auth per org, provisioning-cycle error handling Microsoft's side surfaces back to the customer's IT admin). Recommendation: ship the scheduled sync first (section 8, phase 3), and treat SCIM as a distinct later phase once there's real customer demand for it specifically — polling every 15 minutes is a perfectly reasonable v1 and dramatically cheaper to build correctly.

---

## 6. On-prem Active Directory track (secondary path)

**Sign-in.** On-prem AD has no OIDC endpoint of its own. The realistic option is **ADFS SAML**: the customer's ADFS server acts as the SAML identity provider, CRMITdesk is the service provider. This needs a SAML library (`@node-saml/node-saml` or `samlify`), a per-org SP metadata endpoint, and the customer's IT team configuring a relying-party trust in their ADFS — meaningfully more setup burden on the customer than Entra ID's app-registration flow, which is one more reason to treat this as the fallback path rather than the primary one.

**Provisioning.** CRMITdesk's servers reaching into a customer's internal network to query LDAP directly is a hard sell for most IT/security teams and not something to build as a default expectation. The realistic pattern used by SaaS products in this situation: a **lightweight sync agent the customer installs inside their own network**, which queries local AD via LDAP and pushes user/group data *outbound* to a CRMITdesk API endpoint (outbound-only traffic, no inbound firewall rule needed on the customer's side — much easier for their IT team to approve). This is a real, separate deliverable (a small standalone service, likely Node or .NET, that the customer runs — probably as a Docker container or Windows service) and should be scoped and estimated on its own once there's a concrete customer asking for it; it's flagged here as phase 5 rather than detailed further, since building it speculatively without a real on-prem customer to validate against is a good way to build the wrong thing.

Given the Entra Connect point in section 1, it's worth explicitly asking: does *this specific* customer driving the request actually lack Entra ID, or do they have on-prem AD synced to Entra ID already (very common)? If the latter, the Entra ID track alone covers them and the on-prem track can stay deprioritized.

---

## 7. New dependencies

Server: `@azure/msal-node` or `openid-client` (OIDC/authorization-code handling — recommended over hand-rolling JWKS validation given how much more there is to get right than the Google flow), `jsonwebtoken`+`jwks-rsa` if going the lower-level route instead, `@node-saml/node-saml` (SAML, needed for both ADFS and as an Entra ID SAML alternative), `@simplewebauthn`-style SCIM library or a hand-built SCIM router if/when phase 4 happens, `node-cron` or reuse of the existing background-jobs scheduler for the sync job (check what the existing Jobs system already uses before adding a new scheduler).

Client: `@azure/msal-browser` if doing the redirect from the client side, though a server-driven redirect (client just links to `/auth/entra/login`, server handles the whole OIDC dance) avoids needing an MSAL.js dependency at all and is simpler given the existing pattern of the client staying thin on auth (Google's client-side piece is only there because Google's flow is specifically designed for client-side ID-token issuance; Entra's authorization-code flow doesn't need that).

---

## 8. Phased rollout

1. **Entra ID OIDC single sign-on, login only.** New `DirectoryConfig` model (Entra-only fields for now), admin settings page to register tenant/client ID/secret, `/auth/entra/login` + `/auth/entra/callback`, login against existing users only (no auto-create yet — an admin still invites people the normal way, but invited users can then sign in with Microsoft instead of a password). This alone ships real value and de-risks the OIDC plumbing before provisioning logic sits on top of it.
2. **JIT provisioning + group-to-role mapping.** `DirectoryRoleMapping` model, group-claim/Graph lookup, auto-create on first SSO login, role assignment/updates from group membership.
3. **Scheduled sync (create ahead of first login + deprovisioning).** Background job against Microsoft Graph, `DirectorySyncLog`, admin-visible sync status/history.
4. **On-prem: ADFS SAML login**, for customers without Entra ID at all.
5. **On-prem: customer-run LDAP sync agent**, scoped properly once a real customer needs it.
6. **(Future, demand-driven) SCIM push provisioning** as the near-real-time alternative to phase 3's polling, if/when a customer specifically requires it.

Phases 1–3 (the Entra ID track) are the ones to commit to now; 4–6 are real but should stay loosely scoped until there's a specific customer pulling for them, since on-prem integration effort is highly dependent on that customer's specific ADFS/AD setup.

---

## 9. Security notes

`ssoEnforced` (once set) should block password login for that org's users entirely, not just offer SSO as an option — otherwise a compromised/weak password is still a bypass around the SSO an admin thinks they've mandated. State and nonce validation on the OIDC flow (CSRF and replay protection) is table stakes and something `openid-client`/`msal-node` handle correctly out of the box, another reason to prefer them over a hand-rolled implementation. Every provisioning action (user created/deactivated/role-changed via sync) should go through the existing `logAction` audit-log utility, same as manual admin actions — this matters a lot here specifically, because "why did this person's access change" needs an answer when it happened automatically. Client secrets and LDAP bind passwords go through `encryptSecret`, never stored plaintext, matching the mailbox-password precedent. Tenant isolation needs explicit testing: with `DirectoryConfig` keyed per-org and `externalDirectoryId` scoped correctly, make sure there's no path where a user from Org A's Entra tenant could authenticate into Org B's CRMITdesk org (e.g. if two customers reuse the same app registration by mistake, or a `state` parameter isn't tied back to the originating org).

---

## 10. Open questions for you before we scope actual build work

How should org/tenant resolution work at login — per-org login URL, or email-domain lookup at a shared login page (section 5)? Is there a real customer behind the on-prem AD half of this, and do they actually lack Entra ID, or do they sync through Entra Connect already (section 1/6)? Should `ssoEnforced` be an all-or-nothing per-org switch, or does it need to support a transition period where both SSO and password login work side by side while employees migrate? For the default role on JIT-created users with no group mapping match, should that be a configurable "default role" or should unmapped users simply not be provisioned (safer, but means one misconfigured mapping silently locks people out rather than under-privileging them)?
