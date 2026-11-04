import { asset } from '../asset';
import { useState, useEffect, useMemo } from "react";
import { Outlet, NavLink, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  LayoutDashboard, Users, Target, TrendingUp,
  Ticket, FolderTree, BookOpen, LogOut,
  BarChart2, UserCog, Inbox, Zap, Globe, Globe2, CreditCard, Slack, Monitor,
  Mail, GitBranch, Key, Shield, Settings2, Upload, MessageSquare, Palette,
  FileText, Menu, Sparkles, Wand2, Brain, LayoutTemplate, HardDrive, Layers,
  Clock, CalendarCheck, Building2, Receipt, RefreshCw, Wallet, KeyRound,
  Package, Boxes, Wrench, Tag, Briefcase, ClipboardList,
  CheckSquare, CheckCircle2, Network, UserSquare2, ChevronRight, SlidersHorizontal, Rocket,
  PanelTop, ChevronDown, UserRound,
} from "lucide-react";
import { useCustomModules } from "../../api/customModules";
import { useWorkspace } from "../../api/workspace";
import { AISmartSearch } from "../components/AISmartSearch";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { NotificationBell } from "../components/NotificationBell";
import { AiCommandBar } from "../components/AiCommandBar";
import { ChatCopilot } from "../components/ChatCopilot";
import { ThemePicker } from "../components/ThemePicker";
import { useLabels, type LabelEntityKey } from "../../hooks/useLabels";
import { can } from "../permissions";
import { useLicense } from "../../api/billing";
import { useAttendanceHeartbeat } from "../../hooks/useAttendanceHeartbeat";
import { AlertTriangle } from "lucide-react";

// Which nav routes / page-title routes correspond to a relabelable entity —
// same 4 entities the AI Setup Generator can propose overrides for
// (aiStudio.controller.ts ENTITY_KEYS). Anything not listed here just keeps
// its hardcoded label, override or not.
const ROUTE_ENTITY: Record<string, { key: LabelEntityKey; form: "singular" | "plural" }> = {
  "/itdesk/tickets": { key: "ticket",  form: "plural" },
  "/crm/deals":      { key: "deal",    form: "plural" },
  "/crm/leads":      { key: "lead",    form: "plural" },
  "/crm/contacts":   { key: "contact", form: "plural" },
};

// Nav sections

type NavItem = {
  to: string;
  label: string;
  icon: React.ElementType;
  roles?: string[];
  /** Tailwind text-* class tinting the item's icon when inactive. Mid-tone
      (≈500) hues are used so they read on both the light and dark rails. */
  tint?: string;
};

type NavSection = {
  label: string | null;
  roles?: string[];
  items: NavItem[];
};

// Exported so App.tsx can derive server-mirroring route-level role guards
// from the exact same config that drives sidebar visibility (see
// shared/routeAccess.ts) — one source of truth instead of two lists that can
// drift apart.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      { to: "/dashboard",    label: "Dashboard",  icon: LayoutDashboard, tint: "text-indigo-500" },
      { to: "/my-work",      label: "My Work",     icon: CheckSquare,    tint: "text-emerald-500" },
      { to: "/approvals",    label: "Approvals",   icon: CheckCircle2,   tint: "text-teal-500" },
      // /inbox/conversations is ALL_STAFF on the server; without this an
      // EMPLOYEE saw the link and the entire page failed to load.
      { to: "/inbox",        label: "Inbox",       icon: Inbox, tint: "text-sky-500",     roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'] },
      // Team chat is for every org member — employees included.
      { to: "/chat",         label: "Chat",        icon: MessageSquare, tint: "text-violet-500" },
      { to: "/workflows",    label: "Automation",  icon: Zap,   tint: "text-amber-500",   roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/portal-users", label: "Portal",      icon: Globe, tint: "text-cyan-500",    roles: ['SUPER_ADMIN', 'IT_MANAGER'] },
      { to: "/ai-builder",   label: "AI Builder",  icon: Wand2, tint: "text-fuchsia-500", roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      // Platform Phase 3 — describe the business, get the whole workspace.
      { to: "/solution-builder", label: "Solution Builder", icon: Rocket, tint: "text-rose-500", roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/ai-studio",    label: "AI Studio",   icon: Brain, tint: "text-violet-500",  roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
    ],
  },
  {
    label: "CRM",
    roles: ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP'],
    items: [
      { to: "/crm/contacts", label: "Contacts",  icon: Users,      tint: "text-blue-500" },
      { to: "/crm/leads",    label: "Leads",     icon: Target,     tint: "text-orange-500" },
      { to: "/crm/deals",    label: "Pipeline",  icon: TrendingUp, tint: "text-emerald-500" },
      { to: "/quotes",       label: "Quotes",    icon: FileText,   tint: "text-indigo-500" },
      { to: "/invoices",     label: "Invoices",  icon: Receipt,    tint: "text-rose-500" },
      { to: "/campaigns",    label: "Campaigns", icon: Mail,       tint: "text-pink-500" },
    ],
  },
  {
    label: "HR",
    items: [
      { to: "/people",        label: "People",      icon: UserSquare2, tint: "text-violet-500" },
      { to: "/hr/directory",  label: "Org Chart",   icon: Network,     tint: "text-cyan-500" },
      { to: "/hr/org",        label: "Org Structure", icon: Network,   tint: "text-teal-500", roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/hr/attendance", label: "Attendance",  icon: Clock,        tint: "text-amber-500" },
      { to: "/hr/leave",      label: "Leave",       icon: CalendarCheck, tint: "text-green-500" },
      { to: "/hr/payroll",    label: "Payroll",     icon: Wallet,        tint: "text-emerald-500" },
      { to: "/hr/settings",   label: "HR Settings", icon: Building2,     tint: "text-slate-400", roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
    ],
  },
  {
    label: "IT Desk",
    items: [
      { to: "/itdesk/tickets",    label: "Tickets",        icon: Ticket,     tint: "text-red-500" },
      { to: "/itdesk/categories", label: "Categories",     icon: FolderTree, tint: "text-yellow-500" },
      { to: "/itdesk/articles",   label: "Knowledge Base", icon: BookOpen,   tint: "text-sky-500" },
      { to: "/itdesk/assets",     label: "Assets",         icon: Monitor,    tint: "text-purple-500", roles: ['SUPER_ADMIN', 'IT_MANAGER', 'IT_AGENT'] },
      { to: "/change-requests",   label: "Changes",        icon: GitBranch,  tint: "text-orange-500", roles: ['SUPER_ADMIN', 'IT_MANAGER', 'IT_AGENT'] },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/admin/users",   label: "Logins & Invites", icon: UserCog,  roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/analytics",     label: "Analytics",     icon: BarChart2, roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/reports",       label: "Reports",       icon: BarChart2, roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/import",        label: "Import CSV",    icon: Upload,    roles: ['SUPER_ADMIN', 'CRM_MANAGER'] },
      // Same shape as Branding: the definitions list is readable by anyone,
      // but creating/editing/deleting a field is MANAGERS-only, and that is
      // the entire purpose of this admin screen.
      { to: "/custom-fields", label: "Custom Fields", icon: Settings2, roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/custom-modules", label: "Custom Modules", icon: Layers, roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      // Every /templates/* endpoint is ALL_STAFF — the page is unusable for
      // an EMPLOYEE, who saw four empty tabs and four permission errors.
      { to: "/templates",     label: "Templates",     icon: LayoutTemplate, roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'] },
      // Reading branding is open, but every write (PUT /branding) is MANAGERS.
      // It is an org-settings screen: showing it to staff who cannot save
      // anything is a dead end, so it follows the same roles as its writes.
      { to: "/branding",      label: "Branding",      icon: Palette, roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      // Workspace identity (platform Phase 1) — rename/hide anything above.
      // Never listed as hideable in its own settings page, so admins can't
      // strand themselves.
      { to: "/workspace",     label: "Workspace",     icon: SlidersHorizontal, roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      // Public web-to-lead / web-to-ticket forms — same manager roles as the
      // record types the submissions create.
      { to: "/web-forms",     label: "Web Forms",     icon: PanelTop,  roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/org-settings",  label: "Org Settings",  icon: Globe2,    roles: ['SUPER_ADMIN'] },
      { to: "/admin/roles",   label: "Roles & Permissions", icon: Shield, roles: ['SUPER_ADMIN'] },
      { to: "/admin/ai-governance", label: "AI Governance", icon: Brain, roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/audit-logs",    label: "Audit Log",     icon: Shield,    roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/api-keys",      label: "API Keys",      icon: Key,       roles: ['SUPER_ADMIN'] },
      { to: "/jobs",          label: "Background Jobs", icon: RefreshCw, roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
    ],
  },
  {
    label: "Integrations",
    items: [
      { to: "/slack",        label: "Slack",        icon: Slack,        roles: ['SUPER_ADMIN', 'IT_MANAGER'] },
      { to: "/teams",        label: "Teams",        icon: MessageSquare, roles: ['SUPER_ADMIN', 'IT_MANAGER'] },
      { to: "/directory-sso", label: "Single Sign-On", icon: KeyRound,   roles: ['SUPER_ADMIN', 'IT_MANAGER'] },
      { to: "/storage",      label: "Storage",      icon: HardDrive,    roles: ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] },
      { to: "/billing",      label: "Billing",      icon: CreditCard,   roles: ['SUPER_ADMIN'] },
      { to: "/security/2fa", label: "2FA Security", icon: Shield },
    ],
  },
];

// Icon an org can pick for a custom module (CustomModule.icon, currently only
// ever "Layers" since CustomModulesPage.tsx's create form has no picker yet —
// this map exists so a future picker (or a hand-edited value) just works
// without a matching code change here. Unknown/unset names fall back to Layers.
const CUSTOM_MODULE_ICONS: Record<string, React.ElementType> = {
  Layers, Package, Boxes, Wrench, Tag, Briefcase, ClipboardList, FileText, Building2, Monitor,
};

// Route -> page title map (for topbar)
const PAGE_TITLES: Record<string, string> = {
  "/dashboard":         "Dashboard",
  "/my-work":           "My Work",
  "/approvals":         "Approvals",
  "/people":            "People",
  "/hr/employees":      "People",
  "/hr/directory":      "Employees",
  "/hr/org":            "Org Structure",
  "/inbox":             "Inbox",
  "/chat":              "Team Chat",
  "/workflows":         "Automation",
  "/portal-users":      "Customer Portal",
  "/crm/contacts":      "Contacts",
  "/crm/leads":         "Leads",
  "/crm/deals":         "Pipeline",
  "/quotes":            "Quotes",
  "/invoices":          "Invoices",
  "/campaigns":         "Campaigns",
  "/hr/attendance":     "Attendance",
  "/hr/leave":          "Leave",
  "/hr/payroll":        "Payroll",
  "/hr/settings":       "HR Settings",
  "/itdesk/tickets":    "Tickets",
  "/itdesk/categories": "Categories",
  "/itdesk/articles":   "Knowledge Base",
  "/itdesk/assets":     "Assets",
  "/change-requests":   "Change Requests",
  "/admin/users":       "Users",
  "/analytics":         "Analytics",
  "/reports":           "Reports",
  "/import":            "Bulk Import",
  "/custom-fields":     "Custom Fields",
  "/custom-modules":    "Custom Modules",
  "/templates":         "Templates",
  "/branding":          "Branding",
  "/workspace":         "Workspace Settings",
  "/web-forms":         "Web Forms",
  "/solution-builder":  "AI Solution Builder",
  "/org-settings":      "Org Settings",
  "/audit-logs":        "Audit Log",
  "/api-keys":          "API Keys",
  "/jobs":              "Background Jobs",
  "/slack":             "Slack Integration",
  "/teams":             "Microsoft Teams",
  "/directory-sso":     "Single Sign-On",
  "/storage":           "Storage",
  "/billing":           "Billing",
  "/billing/custom":    "Custom Licence",
  "/security/2fa":      "2FA Security",
  "/ai-builder":        "AI Feature Builder",
  "/ai-studio":         "AI Studio",
  "/profile":           "My Profile",
};

/* Sections that default to collapsed — utility areas, not daily work. A
   section always re-opens itself while it contains the active route. */
const DEFAULT_COLLAPSED = ["Admin", "Integrations"];
const COLLAPSE_KEY = "ui-nav-collapsed";

function readCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through */ }
  return DEFAULT_COLLAPSED;
}

// Sidebar nav item

function SideNavItem({ to, label, icon: Icon, tint, onClick }: {
  to: string; label: string; icon: React.ElementType; tint?: string; onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `nav-item group relative flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13px] transition-colors duration-100 ${
          isActive
            ? "nav-item-active bg-sidebar-active text-sidebar-active-fg font-semibold"
            : "font-medium text-sidebar-fg/90 hover:text-sidebar-fg hover:bg-sidebar-hover"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* Accent bar marking the active route */}
          {isActive && (
            <span className="nav-active-bar absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-accent" aria-hidden="true" />
          )}
          <Icon
            size={15}
            strokeWidth={isActive ? 2.2 : 1.9}
            className={`shrink-0 ${
              isActive
                ? "text-sidebar-active-fg"
                : tint ?? "text-sidebar-heading group-hover:text-sidebar-fg"
            } transition-colors duration-100`}
          />
          <span className="truncate flex-1">{label}</span>
        </>
      )}
    </NavLink>
  );
}

// Sidebar content

function SidebarContent({ user, onLogout, onNavClick }: {
  user: any; onLogout: () => void; onNavClick?: () => void;
}) {
  const userRole: string | undefined = user?.role;
  const { entityLabel } = useLabels();
  const workspace = useWorkspace();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);

  function toggleSection(label: string) {
    setCollapsed(prev => {
      const next = prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label];
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* fine */ }
      return next;
    });
  }

  // Each org's own custom modules (see modules/custom-modules) get their own
  // sidebar entry here, instead of only being reachable through the generic
  // "Custom Modules" builder link under Admin — that link is still there for
  // defining fields/sync; these are the day-to-day "go look at the records"
  // links. Folded into whichever existing section the module's own
  // CustomModule.navSection picks (set on the module — see
  // CreateModuleModal/EditModuleModal in CustomModulesPage.tsx), rather than
  // always CRM or a dedicated section — appended only for rendering (NOT
  // pushed into the exported NAV_SECTIONS, since routeAccess.ts derives its
  // role guard from that array). Note this means a module's link inherits
  // whichever section it's placed in's role restriction for sidebar
  // *visibility* (e.g. an IT Desk-placed module is hidden from a SALES_REP).
  // The underlying /modules/:slug route and the records API itself stay
  // ALL_STAFF/unrestricted regardless of placement (see App.tsx's route
  // comment) — this only affects whether it shows up in the sidebar, same
  // "hidden from nav, not blocked by URL" pattern routeAccess.ts already
  // uses everywhere else.
  const NAV_SECTION_LABELS: Record<string, string> = { CRM: "CRM", IT_DESK: "IT Desk", HR: "HR", ADMIN: "Admin" };
  // ALL_STAFF on the server — asking as an EMPLOYEE 403s on every navigation,
  // and they cannot read module records anyway, so there is no link to build.
  const { data: customModules } = useCustomModules(can.readStaffRecords(userRole));
  const visibleModules = (customModules ?? []).filter((m: any) => m.isActive && (m._count?.fields ?? 0) > 0);
  const sections: NavSection[] = visibleModules.length
    ? NAV_SECTIONS.map(section => {
        const items = visibleModules
          .filter((m: any) => (NAV_SECTION_LABELS[m.navSection] ?? "CRM") === section.label)
          .map((m: any): NavItem => ({ to: `/modules/${m.slug}`, label: m.name, icon: CUSTOM_MODULE_ICONS[m.icon] ?? Layers, tint: "text-indigo-400" }));
        return items.length ? { ...section, items: [...section.items, ...items] } : section;
      })
    : NAV_SECTIONS;

  return (
    <div className="flex flex-col h-full">
      {/* Workspace header */}
      <div className="px-4 h-topbar flex items-center border-b border-sidebar-line shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src={asset("logo.svg")} alt="" className="w-8 h-8 shrink-0" />
          <p className="text-sidebar-fg font-extrabold text-[17px] leading-tight truncate tracking-tight">
            {workspace.appName}
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 overflow-y-auto sidebar-scroll">
        {sections.map((section) => {
          // Hide section if user's role is not allowed
          if (section.roles && userRole && !section.roles.includes(userRole)) return null;
          // Workspace skin: whole section hidden for this org (presentation
          // only — routes stay reachable, same pattern as role filtering).
          if (workspace.isSectionHidden(section.label)) return null;

          // Filter items by role, then by the workspace skin's hidden routes
          const visibleItems = section.items.filter(
            item => (!item.roles || !userRole || item.roles.includes(userRole)) && !workspace.isRouteHidden(item.to)
          );
          if (visibleItems.length === 0) return null;

          const containsActive = visibleItems.some(i => location.pathname.startsWith(i.to));
          const isCollapsed = section.label
            ? collapsed.includes(section.label) && !containsActive
            : false;

          return (
            <div key={section.label ?? "__top"} className={section.label ? "mt-4" : ""}>
              {section.label && (
                <button
                  type="button"
                  onClick={() => toggleSection(section.label!)}
                  aria-expanded={!isCollapsed}
                  className="group/sec w-full flex items-center gap-1 px-2.5 mb-1 text-[10.5px] font-semibold text-sidebar-heading uppercase tracking-[0.08em] hover:text-sidebar-muted transition-colors"
                >
                  <span className="truncate">{workspace.sectionLabel(section.label)}</span>
                  <ChevronRight
                    size={11}
                    className={`shrink-0 opacity-0 group-hover/sec:opacity-100 transition-all duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                  />
                </button>
              )}
              {!isCollapsed && (
                <div className="space-y-px">
                  {visibleItems.map(item => {
                    const override = ROUTE_ENTITY[item.to];
                    // Workspace rename wins over the AI Studio entity label —
                    // it's the more explicit, hand-set (or Solution Builder-
                    // set) choice; entity labels remain the fallback.
                    const base = override ? entityLabel(override.key, override.form, item.label) : item.label;
                    const label = workspace.navLabel(item.to, base);
                    return <SideNavItem key={item.to} to={item.to} label={label} icon={item.icon} tint={item.tint} onClick={onNavClick} />;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer — the profile chip lives in the top bar */}
      <div className="border-t border-sidebar-line p-2.5 shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={onLogout}
            className="flex-1 flex items-center gap-2 h-8 px-2.5 text-[12.5px] font-medium text-sidebar-muted hover:text-danger hover:bg-danger-soft rounded-md transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
          <ThemePicker />
        </div>
      </div>
    </div>
  );
}

/** "SUPER_ADMIN" -> "Super Admin". */
function roleLabel(role?: string | null): string {
  if (!role) return "My profile";
  return role.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// Main Layout

export function AppLayout() {
  const { user, logout } = useAuth();
  // Geofence auto check-out: location heartbeats while a session is open (no-op unless the org enabled it)
  useAttendanceHeartbeat(!!user);
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiBarOpen, setAiBarOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Close sidebar on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Cmd+K / Ctrl+K to toggle AI command bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setAiBarOpen(prev => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const { entityLabel } = useLabels();
  const workspace = useWorkspace();
  const routeOverride = ROUTE_ENTITY[location.pathname];
  // /modules/:slug has no static PAGE_TITLES entry (one per org-defined
  // module, can't be hardcoded) — fall back to that module's own name if the
  // list happens to already be cached (it always will be, since the sidebar
  // itself just fetched it) rather than showing the generic app name.
  const { data: customModulesForTitle } = useCustomModules(can.readStaffRecords(user?.role));
  const moduleTitleMatch = location.pathname.startsWith("/modules/")
    ? customModulesForTitle?.find((m: any) => `/modules/${m.slug}` === location.pathname)?.name
    : undefined;
  const baseTitle = routeOverride
    ? entityLabel(routeOverride.key, routeOverride.form, PAGE_TITLES[location.pathname] ?? "")
    : (PAGE_TITLES[location.pathname] ?? moduleTitleMatch ?? workspace.appName);
  // Workspace skin rename (keyed by route) wins over everything else.
  const pageTitle = workspace.navLabel(location.pathname, baseTitle);

  // Browser tab mirrors the workspace identity — a reskinned org's users see
  // "Service Jobs · DealerTrack Pro", never the underlying product name.
  useEffect(() => {
    document.title = pageTitle && pageTitle !== workspace.appName
      ? `${pageTitle} · ${workspace.appName}`
      : workspace.appName;
  }, [pageTitle, workspace.appName]);

  // "CRM / Leads" style context for the top bar — which section owns the route
  const sectionLabel = useMemo(() => {
    for (const s of NAV_SECTIONS) {
      if (s.label && s.items.some(i => location.pathname.startsWith(i.to))) {
        return workspace.sectionLabel(s.label);
      }
    }
    return null;
  }, [location.pathname, workspace.config]);

  return (
    <div className="app-shell flex h-screen bg-canvas overflow-hidden">

      {/* Skip link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-surface focus:text-fg focus:px-3 focus:py-2 focus:rounded-md focus:shadow-ui-lg"
      >
        Skip to content
      </a>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          app-sidebar fixed inset-y-0 left-0 z-50 w-sidebar flex flex-col bg-sidebar border-r border-sidebar-line shadow-ui-lg
          transition-transform duration-200 ease-out
          lg:relative lg:translate-x-0 lg:shadow-none lg:z-auto lg:pointer-events-auto
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"}
        `}
      >
        <SidebarContent user={user} onLogout={handleLogout} onNavClick={() => setSidebarOpen(false)} />
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="app-topbar flex-shrink-0 flex items-center gap-3 px-4 lg:px-6 h-topbar bg-surface/85 backdrop-blur-md border-b border-line-subtle z-30">
          {/* Hamburger — mobile only */}
          <button
            className="lg:hidden p-1.5 -ml-1 rounded-md text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={19} />
          </button>

          {/* Context — section / page. <p> not <h1>: PageHeader owns the h1. */}
          <p className="hidden sm:flex items-center gap-1.5 text-[13px] min-w-0">
            {sectionLabel && (
              <>
                <span className="text-fg-subtle font-medium shrink-0">{sectionLabel}</span>
                <ChevronRight size={12} className="text-fg-subtle/60 shrink-0" />
              </>
            )}
            <span className="font-semibold text-fg truncate">{pageTitle}</span>
          </p>

          <div className="flex-1" />

          {/* Search — desktop */}
          <div className="search-pill hidden md:block w-72 xl:w-96">
            <AISmartSearch className="w-full" placeholder="Search anything…" />
          </div>

          {/* AI Command Bar button */}
          <button
            data-testid="ai-command-btn"
            onClick={() => setAiBarOpen(true)}
            className="flex items-center gap-1.5 h-9 px-3.5 bg-accent hover:bg-accent-hover active:bg-accent-active text-accent-fg text-xs font-semibold rounded-btn shadow-ui-sm transition-colors"
            title="AI Command (Ctrl+K)"
          >
            <Sparkles size={13} />
            <span>Ask AI</span>
            <kbd className="ui-kbd hidden xl:inline-flex !bg-white/15 !border-white/20 !text-accent-fg/90">⌘K</kbd>
          </button>

          <NotificationBell />

          {/* Profile chip — role and organisation, never the person's name */}
          <Link
            to="/profile"
            className="flex items-center gap-2.5 h-10 pl-1 pr-1 sm:pr-3 rounded-full bg-surface border border-line shadow-ui-sm hover:shadow-ui-md transition-shadow shrink-0"
            aria-label="My profile"
            title="My profile"
          >
            <span className="w-8 h-8 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
              <UserRound size={17} />
            </span>
            <span className="hidden sm:block min-w-0 max-w-[160px] text-left leading-tight">
              <span className="block text-[13px] font-bold text-fg truncate">{roleLabel(user?.role)}</span>
              {user?.org?.name && <span className="block text-[11px] text-fg-muted truncate">{user.org.name}</span>}
            </span>
            <ChevronDown size={14} className="hidden sm:block text-fg-subtle shrink-0" />
          </Link>
        </header>

        {/* Mobile search bar */}
        <div className="search-pill md:hidden px-4 py-2 bg-surface border-b border-line-subtle">
          <AISmartSearch className="w-full" placeholder="Search anything…" />
        </div>

        <LicenceBanner role={user?.role} />

        {/* Page content */}
        <main id="main-content" className="flex-1 overflow-y-auto">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <AiCommandBar open={aiBarOpen} onClose={() => setAiBarOpen(false)} />
      {/* Floating chat copilot — chat that answers questions and executes
          confirmed actions (tickets, leads, notes, leave, assignments). */}
      <ChatCopilot />
    </div>
  );
}

/** Payment-state strip shown on every page while a paid licence is in its
 *  grace period or has lapsed (GET /billing/entitlements). Nothing renders
 *  for a healthy subscription. */
function LicenceBanner({ role }: { role?: string | null }) {
  const { data: lic } = useLicense(!!role);
  if (!lic || lic.access === "full") return null;
  const lapsed = lic.access === "lapsed";
  return (
    <div
      data-testid="licence-banner"
      role="status"
      className={`flex items-center gap-3 px-4 py-2 text-[12.5px] border-b ${lapsed ? "bg-danger/10 text-danger border-danger/30" : "bg-warning/10 text-warning border-warning/30"}`}
    >
      <AlertTriangle size={15} className="shrink-0" />
      <span className="flex-1">
        <strong>{lapsed ? "Licence inactive — limited to Free-plan features." : "Payment issue — grace period active."}</strong> {lic.reason}
      </span>
      {can.readBilling(role) && <Link to="/billing" className="font-semibold underline whitespace-nowrap">Go to Billing</Link>}
    </div>
  );
}
