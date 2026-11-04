import { NAV_SECTIONS } from './layouts/AppLayout';

// Flattened path -> allowed-roles map, derived from the same NAV_SECTIONS
// config that drives sidebar link visibility. A path with no entry here has
// no role restriction (any authenticated staff role can view it — matches
// items in NAV_SECTIONS with no `roles` on either the section or the item).
//
// Previously the frontend had NO route-level guard at all — hiding a
// sidebar link didn't stop a direct URL visit from rendering the page (the
// underlying API calls were still rejected server-side, so this was never a
// real security hole, just a confusing UX gap — see Technical Docs 14.1).
// RoleRoute in App.tsx reads this map to show an in-app "Access Denied"
// screen instead of silently rendering a page full of 403s.
export const ROUTE_ROLES: Record<string, string[] | undefined> = {};

for (const section of NAV_SECTIONS) {
  for (const item of section.items) {
    // A page is restricted if EITHER its section or the item itself
    // declares roles — intersect when both do, since a user needs both to
    // see it in the sidebar.
    const sectionRoles = section.roles;
    const itemRoles = item.roles;
    let roles: string[] | undefined;
    if (sectionRoles && itemRoles) {
      roles = sectionRoles.filter(r => itemRoles.includes(r));
    } else {
      roles = sectionRoles || itemRoles;
    }
    ROUTE_ROLES[item.to] = roles;
  }
}

export function isRouteAllowed(path: string, role: string | undefined): boolean {
  if (!role) return false;
  // Exact match first (e.g. "/crm/deals"), then fall back to the longest
  // registered prefix (e.g. "/crm/contacts/:id" inherits "/crm/contacts"'s
  // restriction) so detail sub-routes aren't accidentally left unrestricted.
  if (path in ROUTE_ROLES) {
    const allowed = ROUTE_ROLES[path];
    return !allowed || allowed.includes(role);
  }
  let bestMatch = '';
  for (const key of Object.keys(ROUTE_ROLES)) {
    if ((path === key || path.startsWith(key + '/')) && key.length > bestMatch.length) {
      bestMatch = key;
    }
  }
  if (!bestMatch) return true; // unrestricted route
  const allowed = ROUTE_ROLES[bestMatch];
  return !allowed || allowed.includes(role);
}
