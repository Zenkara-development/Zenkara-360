import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppLayout } from './shared/layouts/AppLayout';
import { isRouteAllowed } from './shared/routeAccess';
import { AccessDenied } from './shared/components/AccessDenied';
import { ServerWakingOverlay } from './shared/components/ServerWakingOverlay';

// Eagerly loaded — shown before auth or as portal (must be small/fast)
import { LoginPage } from './pages/LoginPage';
import { DemoLandingPage } from './pages/DemoLandingPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { OrgApprovalPage } from './pages/OrgApprovalPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { PublicQuotePage } from './pages/PublicQuotePage';
import { PublicInvoicePage } from './pages/PublicInvoicePage';
import EntraLoginPage from './pages/EntraLoginPage';
import SsoCallbackPage from './pages/SsoCallbackPage';
import { CustomerPortal } from './modules/portal/CustomerPortal';

// Page skeleton fallback for Suspense
function PageSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 skeleton w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 skeleton" />)}
      </div>
      <div className="h-64 skeleton" />
      <div className="h-48 skeleton" />
    </div>
  );
}

// Named exports — use .then(m => ({ default: m.X }))
const DashboardPage    = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ContactsPage     = lazy(() => import('./modules/crm/contacts/ContactsPage').then(m => ({ default: m.ContactsPage })));
const ContactDetailPage = lazy(() => import('./modules/crm/contacts/ContactDetailPage').then(m => ({ default: m.ContactDetailPage })));
const LeadsPage        = lazy(() => import('./modules/crm/leads/LeadsPage').then(m => ({ default: m.LeadsPage })));
const DealsPage        = lazy(() => import('./modules/crm/deals/DealsPage').then(m => ({ default: m.DealsPage })));
const TicketsPage      = lazy(() => import('./modules/itdesk/tickets/TicketsPage').then(m => ({ default: m.TicketsPage })));
const CategoriesPage   = lazy(() => import('./modules/itdesk/categories/CategoriesPage').then(m => ({ default: m.CategoriesPage })));
const ArticlesPage     = lazy(() => import('./modules/itdesk/articles/ArticlesPage').then(m => ({ default: m.ArticlesPage })));
const UsersPage        = lazy(() => import('./pages/UsersPage').then(m => ({ default: m.UsersPage })));
const ReportsPage      = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const InboxPage        = lazy(() => import('./modules/inbox/InboxPage').then(m => ({ default: m.InboxPage })));
const WorkflowsPage    = lazy(() => import('./modules/workflows/WorkflowsPage').then(m => ({ default: m.WorkflowsPage })));
const TeamChatPage     = lazy(() => import('./pages/TeamChatPage'));
const PortalUsersPage  = lazy(() => import('./modules/portal/PortalUsersPage').then(m => ({ default: m.PortalUsersPage })));
const BillingPage      = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })));
const CustomLicensePage = lazy(() => import('./pages/CustomLicensePage').then(m => ({ default: m.CustomLicensePage })));
const AnalyticsPage    = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const AIFeaturePage    = lazy(() => import('./pages/AIFeaturePage').then(m => ({ default: m.AIFeaturePage })));

// Default exports — direct import()
const SlackPage          = lazy(() => import('./pages/SlackPage'));
const DirectorySSOPage   = lazy(() => import('./pages/DirectorySSOPage'));
const AssetsPage         = lazy(() => import('./modules/itdesk/assets/AssetsPage'));
const CampaignsPage      = lazy(() => import('./pages/CampaignsPage'));
const ChangeRequestsPage = lazy(() => import('./pages/ChangeRequestsPage'));
const ApiKeysPage        = lazy(() => import('./pages/ApiKeysPage'));
const AuditLogPage       = lazy(() => import('./pages/AuditLogPage'));
const JobsPage           = lazy(() => import('./pages/JobsPage'));
const AIStudioPage       = lazy(() => import('./pages/AIStudioPage'));
const CustomFieldsPage   = lazy(() => import('./pages/CustomFieldsPage'));
const TemplatesPage      = lazy(() => import('./pages/TemplatesPage'));
const BulkImportPage     = lazy(() => import('./pages/BulkImportPage'));
const TeamsPage          = lazy(() => import('./pages/TeamsPage'));
const BrandingPage       = lazy(() => import('./pages/BrandingPage'));
const WorkspaceSettingsPage = lazy(() => import('./pages/WorkspaceSettingsPage'));
const SolutionBuilderPage = lazy(() => import('./pages/SolutionBuilderPage'));
const WebFormsPage = lazy(() => import('./pages/WebFormsPage'));
const PublicWebFormPage = lazy(() => import('./pages/PublicWebFormPage'));
const OrgSettingsPage    = lazy(() => import('./pages/OrgSettingsPage'));
const StoragePage        = lazy(() => import('./pages/StoragePage'));
const CustomModulesPage  = lazy(() => import('./pages/CustomModulesPage'));
const CustomModuleViewPage = lazy(() => import('./pages/CustomModuleViewPage'));
const QuotesPage         = lazy(() => import('./pages/QuotesPage'));
const TwoFactorPage      = lazy(() => import('./pages/TwoFactorPage'));
const ProfilePage        = lazy(() => import('./pages/ProfilePage'));
const PlatformAdminPage  = lazy(() => import('./pages/PlatformAdminPage').then(m => ({ default: m.PlatformAdminPage })));
const InvoicesPage       = lazy(() => import('./pages/InvoicesPage'));
const AttendancePage     = lazy(() => import('./modules/hr/AttendancePage'));
// People / task / approval / permission / AI-governance platform. Default
// exports, matching the newer pages above rather than the named-export style
// of the original set.
const MyWorkPage         = lazy(() => import('./modules/tasks/MyWorkPage'));
const EmployeesPage      = lazy(() => import('./modules/hr/EmployeesPage'));
// One People screen over Users + Employees. The two old routes still resolve
// (bookmarks, the e2e suite, links in old emails) — they just land here now.
const PeoplePage         = lazy(() => import('./modules/people/PeoplePage'));
const OrgStructurePage   = lazy(() => import('./modules/hr/OrgStructurePage'));
const ApprovalsPage      = lazy(() => import('./modules/approvals/ApprovalsPage'));
const RolesPermissionsPage = lazy(() => import('./pages/RolesPermissionsPage'));
const AIGovernancePage   = lazy(() => import('./pages/AIGovernancePage'));
const LeavePage          = lazy(() => import('./modules/hr/LeavePage'));
const PayrollPage        = lazy(() => import('./modules/hr/PayrollPage'));
const HRSettingsPage     = lazy(() => import('./modules/hr/HRSettingsPage'));
const PayslipPrintPage   = lazy(() => import('./pages/PayslipPrintPage'));

// PLATFORM_ADMIN users have no orgId — the normal AppLayout/org-scoped pages
// all assume one, so they're routed to the standalone /platform-admin
// console instead and never see the regular app shell.
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role === 'PLATFORM_ADMIN') return <Navigate to="/platform-admin" replace />;
  return <>{children}</>;
}

// Mirrors sidebar visibility (shared/routeAccess.ts, derived from
// AppLayout's NAV_SECTIONS) into an actual navigation guard — previously a
// role that couldn't see e.g. "API Keys" in the sidebar could still open
// /api-keys directly and have the page render (the API itself always
// rejected the requests, so this was a UX gap, not a security hole — see
// Technical Docs 14.1). Renders an in-app Access Denied screen instead of a
// page full of failed requests.
// Wraps the whole nested route tree (see the single <Route element={<RoleGate/>}>
// below) rather than each leaf route individually — one check point instead
// of decorating 30+ <Route> lines, and it can't drift out of sync with new
// routes the way a per-route opt-in list could.
function RoleGate() {
  const { user } = useAuth();
  const location = useLocation();
  if (!isRouteAllowed(location.pathname, user?.role)) return <AccessDenied />;
  return <Outlet />;
}

function PlatformAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'PLATFORM_ADMIN') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'PLATFORM_ADMIN' ? '/platform-admin' : '/dashboard'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      {/* Free-tier cold-start detector: invisible when the API is warm; a
          "waking up the server" panel (instead of endless skeletons) while a
          spun-down backend boots. See shared/components/ServerWakingOverlay. */}
      <ServerWakingOverlay />
      <Routes>
        {/* Public customer portal — outside main app layout */}
        <Route path="/portal" element={<CustomerPortal />} />
        <Route path="/portal/verify" element={<CustomerPortal />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Per-org Entra ID sign-in link (shared by an admin from Settings →
            Single Sign-On) and the landing page Microsoft redirects back to
            once auth.controller.ts entraCallback finishes — both public,
            outside ProtectedRoute, same as /login itself. */}
        <Route path="/login/:orgSlug" element={<EntraLoginPage />} />
        <Route path="/sso-callback" element={<SsoCallbackPage />} />
        <Route path="/demo" element={<DemoLandingPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/approve-org" element={<OrgApprovalPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/quote/:id" element={<PublicQuotePage />} />
        <Route path="/invoice/:id" element={<PublicInvoicePage />} />
        {/* Public hosted web-to-lead / web-to-ticket form — no login, no app
            shell. Orgs embed this URL (or an iframe of it) on their site. */}
        <Route path="/form/:id" element={<Suspense fallback={<PageSkeleton />}><PublicWebFormPage /></Suspense>} />
        <Route path="/platform-admin" element={<PlatformAdminRoute><Suspense fallback={<PageSkeleton />}><PlatformAdminPage /></Suspense></PlatformAdminRoute>} />
        {/* Authenticated but outside AppLayout — no sidebar chrome, so the
            browser's print dialog produces a clean payslip PDF (see
            PayslipPrintPage.tsx's comment). Access to the payslip itself is
            still enforced server-side (own payslip, or any if a manager). */}
        <Route path="/hr/payroll/payslips/:id/print" element={<ProtectedRoute><Suspense fallback={<PageSkeleton />}><PayslipPrintPage /></Suspense></ProtectedRoute>} />
        <Route path="/" element={<ProtectedRoute><Suspense fallback={<PageSkeleton />}><AppLayout /></Suspense></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          {/* RoleGate wraps every page below — see its comment above. Access
              rules come from shared/routeAccess.ts, generated from the exact
              same sidebar config in AppLayout.tsx (NAV_SECTIONS). */}
          <Route element={<RoleGate />}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="crm/contacts" element={<ContactsPage />} />
            <Route path="crm/contacts/:id" element={<ContactDetailPage />} />
            <Route path="crm/leads" element={<LeadsPage />} />
            <Route path="crm/deals" element={<DealsPage />} />
            <Route path="itdesk/tickets" element={<TicketsPage />} />
            <Route path="itdesk/categories" element={<CategoriesPage />} />
            <Route path="itdesk/articles" element={<ArticlesPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="chat" element={<TeamChatPage />} />
            <Route path="workflows" element={<WorkflowsPage />} />
            <Route path="portal-users" element={<PortalUsersPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="billing/custom" element={<CustomLicensePage />} />
            <Route path="slack" element={<SlackPage />} />
            <Route path="directory-sso" element={<DirectorySSOPage />} />
            <Route path="itdesk/assets" element={<AssetsPage />} />
            <Route path="campaigns" element={<CampaignsPage />} />
            <Route path="change-requests" element={<ChangeRequestsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="admin/users" element={<UsersPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route path="audit-logs" element={<AuditLogPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="custom-fields" element={<CustomFieldsPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="import" element={<BulkImportPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="branding" element={<BrandingPage />} />
            <Route path="workspace" element={<WorkspaceSettingsPage />} />
            <Route path="web-forms" element={<WebFormsPage />} />
            <Route path="solution-builder" element={<SolutionBuilderPage />} />
            <Route path="org-settings" element={<OrgSettingsPage />} />
            <Route path="storage" element={<StoragePage />} />
            <Route path="custom-modules" element={<CustomModulesPage />} />
            {/* Individual custom modules' own nav-linked page — the sidebar
                entries for these are injected dynamically in AppLayout.tsx
                (there's one per org-defined module, not a static list here).
                No `roles` restriction: matches the underlying
                /api/custom-modules/:id/records endpoints, which are
                ALL_STAFF-gated server-side (see customModules.routes.ts). */}
            <Route path="modules/:slug" element={<CustomModuleViewPage />} />
            <Route path="quotes" element={<QuotesPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="my-work" element={<MyWorkPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="hr/employees" element={<PeoplePage />} />
            {/* The employee directory with the org chart is still reachable
                directly; People is the everyday entry point. */}
            <Route path="hr/directory" element={<EmployeesPage />} />
            <Route path="hr/org" element={<OrgStructurePage />} />
            <Route path="admin/roles" element={<RolesPermissionsPage />} />
            <Route path="admin/ai-governance" element={<AIGovernancePage />} />
            <Route path="hr/attendance" element={<AttendancePage />} />
            <Route path="hr/leave" element={<LeavePage />} />
            <Route path="hr/payroll" element={<PayrollPage />} />
            <Route path="hr/settings" element={<HRSettingsPage />} />
            <Route path="security/2fa" element={<TwoFactorPage />} />
            <Route path="ai-builder" element={<AIFeaturePage />} />
            <Route path="ai-studio" element={<AIStudioPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Route>
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </AuthProvider>
  );
}
