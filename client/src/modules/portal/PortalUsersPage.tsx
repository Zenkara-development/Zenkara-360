import { useState } from 'react';
import { Users, Plus, ToggleLeft, ToggleRight, Trash2, Send, ExternalLink, Copy, CheckCircle } from 'lucide-react';
import {
  usePortalUsers, useCreatePortalUser, useTogglePortalUser,
  useDeletePortalUser, useResendPortalInvite,
} from '../../api/portalAdmin';
import { useAuth } from '../../contexts/AuthContext';
import {
  RowActions, PageHeader, PageBody, Button, Modal, Card, StatTile, Alert,
  Field, Input, Checkbox, Badge, Avatar, DataTable, EmptyState, AccessDenied,
  type Column,
} from '../../shared/components';
import { useFormat } from '../../hooks/useFormat';
import { can } from '../../shared/permissions';

export function PortalUsersPage() {
  const { user } = useAuth();
  /* /portal-users is IT_MANAGERS-only on the server. */
  const canReadPortalUsers = can.readPortalUsers(user?.role);
  const { date } = useFormat();
  const { data: portalUsers = [], isLoading } = usePortalUsers(canReadPortalUsers);
  const createUser = useCreatePortalUser();
  const toggleUser = useTogglePortalUser();
  const deleteUser = useDeletePortalUser();
  const resendInvite = useResendPortalInvite();

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [copied, setCopied] = useState(false);

  // After every hook.
  if (!canReadPortalUsers) return <AccessDenied />;

  const orgId = user?.orgId || '';
  const portalUrl = `${window.location.origin}/portal?org=${orgId}`;

  function copyPortalLink() {
    navigator.clipboard.writeText(portalUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  function handleCreate() {
    createUser.mutate({ name, email, sendInvite }, {
      onSuccess: () => { setShowModal(false); setName(''); setEmail(''); setSendInvite(true); }
    });
  }

  type PortalUser = (typeof portalUsers)[number];

  const columns: Column<PortalUser>[] = [
    {
      key: 'customer',
      header: 'Customer',
      cell: u => (
        <div className="flex items-center gap-3">
          <Avatar name={u.name} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-fg truncate" title={u.name}>{u.name}</p>
            <p className="text-xs text-fg-subtle truncate" title={u.email}>{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: u => <Badge variant={u.isActive ? 'green' : 'gray'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'lastLogin',
      header: 'Last login',
      hideBelow: 'sm',
      muted: true,
      cell: u => (u.lastLoginAt ? <span className="tabular-nums">{date(u.lastLoginAt)}</span> : <span className="text-fg-subtle">Never</span>),
    },
    {
      key: 'added',
      header: 'Added',
      hideBelow: 'md',
      muted: true,
      cell: u => <span className="tabular-nums">{date(u.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: u => (
        <RowActions items={[
          { label: 'Resend invite', icon: <Send size={13} />, onClick: () => resendInvite.mutate(u.id) },
          { label: u.isActive ? 'Deactivate' : 'Activate', icon: u.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />, onClick: () => toggleUser.mutate(u.id) },
          { label: 'Remove user', icon: <Trash2 size={13} />, onClick: () => { if (confirm('Remove this portal user?')) deleteUser.mutate(u.id); }, variant: 'danger' },
        ]} />
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Customer Portal"
        subtitle="Manage customer access to the self-service support portal."
        actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setShowModal(true)}>Add Customer</Button>}
      />

      <div className="flex-1 overflow-auto">
        <PageBody width="full" className="max-w-4xl mx-auto">
      {/* Portal Link Banner */}
      <Alert
        tone="accent"
        icon={null}
        title="Portal Link"
        actions={<>
          <Button size="sm" variant="secondary" icon={copied ? <CheckCircle size={12} /> : <Copy size={12} />} onClick={copyPortalLink}>
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
          {/* Stays an <a> — Button has no polymorphic `as`, and this must open
              a real new tab rather than a scripted popup. */}
          <a
            href={portalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 h-ctl-sm text-[12.5px] font-medium rounded-btn bg-accent text-accent-fg shadow-ui-sm hover:bg-accent-hover transition-colors"
          >
            <ExternalLink size={12} /> Preview
          </a>
        </>}
      >
        <p className="text-xs truncate">{portalUrl}</p>
      </Alert>

      {/* Stats */}
      {portalUsers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label="Total Customers" value={portalUsers.length} />
          <StatTile label="Active" value={portalUsers.filter(u => u.isActive).length} />
          <StatTile label="Never logged in" value={portalUsers.filter(u => !u.lastLoginAt).length} />
        </div>
      )}

      {/* User list */}
      {isLoading ? (
        <Card padding="none" className="overflow-hidden">
          <DataTable columns={columns} rows={[]} rowKey={() => ''} loading />
        </Card>
      ) : portalUsers.length === 0 ? (
        <Card padding="none" flat className="border-dashed">
          <EmptyState
            icon={<Users />}
            title="No portal customers yet"
            description="Add customers to give them access to submit and track support tickets without a full account."
            action={{ label: 'Add first customer', onClick: () => setShowModal(true) }}
          />
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={portalUsers}
            rowKey={u => u.id}
            minWidth={640}
          />
        </Card>
      )}
        </PageBody>
      </div>

      {/* Add Customer Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Add Portal Customer"
        footer={<>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name || !email} loading={createUser.isPending}>
            Add Customer
          </Button>
        </>}
      >
        <div className="form-section">
          <p className="form-section-title">Customer Details</p>
          <div className="space-y-4">
            <Field label="Full Name" required htmlFor="portal-user-name">
              <Input id="portal-user-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane Smith" />
            </Field>
            <Field label="Email" required htmlFor="portal-user-email">
              <Input id="portal-user-email" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="jane@company.com" />
            </Field>
            <Checkbox
              checked={sendInvite}
              onChange={e => setSendInvite(e.target.checked)}
              label="Send invite email with portal link"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
