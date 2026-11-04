import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import {
  Monitor, Plus, Pencil, Trash2,
  Package, Wrench, Archive, Activity
} from 'lucide-react';
import {
  SearchableSelect, RowActions, PageHeader, PageBody, Toolbar, Button, Modal, Card, StatTile,
  Field, Input, Select, SearchInput, Badge, Avatar, DataTable, EmptyState,
  type Column, RecordTasks, RecordTags} from '../../../shared/components';
import { Attachments } from '../../../shared/components/Attachments';
import { useFormat } from '../../../hooks/useFormat';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Asset {
  id: string;
  name: string;
  type: string;
  serialNumber?: string | null;
  assignedTo?: string | null;
  status: string;
  purchaseDate?: string | null;
  createdAt: string;
  assignee?: { id: string; name: string; email: string } | null;
}

interface Stats {
  total: number;
  active: number;
  retired: number;
  inRepair: number;
  byType: Array<{ type: string; _count: number }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUSES = ['active', 'inactive', 'retired', 'in_repair'];
const ASSET_TYPES = ['Laptop', 'Desktop', 'Monitor', 'Phone', 'Tablet', 'Server', 'Printer', 'Network', 'Peripheral', 'Other'];

/* Status colours come from Badge's shared palette rather than a local map. */
const STATUS_VARIANT: Record<string, 'green' | 'gray' | 'red' | 'yellow'> = {
  active: 'green', inactive: 'gray', retired: 'red', in_repair: 'yellow',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', inactive: 'Inactive', retired: 'Retired', in_repair: 'In Repair',
};

// ─── Asset Form Modal ─────────────────────────────────────────────────────────

interface FormData {
  name: string; type: string; serialNumber: string;
  assignedTo: string; status: string; purchaseDate: string;
}

const EMPTY: FormData = { name: '', type: 'Laptop', serialNumber: '', assignedTo: '', status: 'active', purchaseDate: '' };

const ASSET_FORM_ID = 'asset-form';

function AssetModal({ asset, users, onClose }: {
  asset?: Asset; users: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormData>(asset ? {
    name: asset.name, type: asset.type, serialNumber: asset.serialNumber ?? '',
    assignedTo: asset.assignedTo ?? '', status: asset.status,
    purchaseDate: asset.purchaseDate ? asset.purchaseDate.split('T')[0] : '',
  } : EMPTY);

  const save = useMutation({
    mutationFn: (data: any) =>
      asset ? api.patch(`/itdesk/assets/${asset.id}`, data) : api.post('/itdesk/assets', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); onClose(); },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({
      name: form.name, type: form.type,
      serialNumber: form.serialNumber || undefined,
      assignedTo: form.assignedTo || null,
      status: form.status,
      purchaseDate: form.purchaseDate || null,
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={asset ? 'Edit Asset' : 'Add Asset'}
      footer={<>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form={ASSET_FORM_ID} loading={save.isPending}>
          {save.isPending ? 'Saving…' : asset ? 'Save Changes' : 'Save Asset'}
        </Button>
      </>}
    >
      <form id={ASSET_FORM_ID} onSubmit={submit} className="space-y-3">
        <div className="form-section">
          <p className="form-section-title">Asset Information</p>
          <div className="space-y-4">
            <Field label="Asset Name" required htmlFor="asset-name">
              <Input id="asset-name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required
                aria-label="Name" placeholder="e.g. MacBook Pro 14" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Type" required>
                <SearchableSelect ariaLabel="Type" value={form.type} onChange={val => setForm(p => ({ ...p, type: val }))} required options={ASSET_TYPES.map(t => ({ value: t, label: t }))} />
              </Field>
              <Field label="Status">
                <SearchableSelect ariaLabel="Status" value={form.status} onChange={val => setForm(p => ({ ...p, status: val }))} required options={STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s] }))} />
              </Field>
            </div>
            <Field label="Serial Number" htmlFor="asset-serial">
              <Input id="asset-serial" value={form.serialNumber} onChange={e => setForm(p => ({ ...p, serialNumber: e.target.value }))}
                aria-label="Serial Number" placeholder="e.g. SN-12345" />
            </Field>
          </div>
        </div>
        <div className="form-section">
          <p className="form-section-title">Assignment</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Assigned To">
              <SearchableSelect ariaLabel="Assigned To" value={form.assignedTo} onChange={val => setForm(p => ({ ...p, assignedTo: val }))} options={users.map(u => ({ value: u.id, label: u.name }))} placeholder="— Unassigned —" />
            </Field>
            <Field label="Purchase Date" htmlFor="asset-purchase-date">
              <Input id="asset-purchase-date" type="date" value={form.purchaseDate} onChange={e => setForm(p => ({ ...p, purchaseDate: e.target.value }))} />
            </Field>
          </div>
        </div>
        {asset && <>
              <RecordTags entityType="ASSET" entityId={asset.id} />
              <Attachments entityType="ASSET" entityId={asset.id} />
              <RecordTasks entityType="ASSET" entityId={asset.id} />
            </>}
      </form>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AssetsPage() {
  const { date } = useFormat();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [modal, setModal] = useState<Asset | null | 'new'>(null);

  const { data: statsData } = useQuery<Stats>({
    queryKey: ['assets-stats'],
    queryFn: () => api.get('/itdesk/assets/stats').then(r => r.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/admin/users').then(r => r.data?.data ?? r.data ?? []),
  });

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (filterStatus) params.set('status', filterStatus);
  if (filterType) params.set('type', filterType);
  params.set('limit', '50');

  const { data, isLoading } = useQuery<{ data: Asset[]; total: number }>({
    queryKey: ['assets', search, filterStatus, filterType],
    queryFn: () => api.get(`/itdesk/assets?${params}`).then(r => r.data),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/itdesk/assets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['assets-stats'] });
    },
  });

  const assets = data?.data ?? [];
  const users = usersData ?? [];

  const columns: Column<Asset>[] = [
    { key: 'name', header: 'Asset', cell: a => <p className="font-medium text-fg truncate max-w-[220px]" title={a.name}>{a.name}</p> },
    { key: 'type', header: 'Type', muted: true, cell: a => a.type },
    {
      key: 'serial', header: 'Serial #', hideBelow: 'sm', muted: true,
      cell: a => <span className="font-mono text-xs tabular-nums" title={a.serialNumber ?? undefined}>{a.serialNumber ?? '—'}</span>,
    },
    {
      key: 'assignee', header: 'Assigned To',
      cell: a => a.assignee ? (
        <div className="flex items-center gap-2">
          <Avatar name={a.assignee.name} size="xs" />
          <span className="text-fg truncate max-w-[100px]" title={a.assignee.name}>{a.assignee.name}</span>
        </div>
      ) : (
        <span className="text-fg-subtle italic">Unassigned</span>
      ),
    },
    {
      key: 'status', header: 'Status',
      cell: a => (
        <Badge variant={STATUS_VARIANT[a.status] ?? 'gray'}>
          {STATUS_LABEL[a.status] ?? a.status}
        </Badge>
      ),
    },
    {
      key: 'purchaseDate', header: 'Purchase Date', hideBelow: 'sm', muted: true,
      cell: a => a.purchaseDate ? date(a.purchaseDate) : '—',
    },
    {
      key: 'actions', header: '', align: 'right',
      cell: a => (
        <div className="flex items-center gap-1 justify-end">
          <RowActions items={[
            { label: 'Edit asset', icon: <Pencil size={14} />, onClick: () => setModal(a) },
            { label: 'Delete asset', icon: <Trash2 size={14} />, onClick: () => { if (confirm('Delete this asset?')) remove.mutate(a.id); }, variant: 'danger' },
          ]} />
        </div>
      ),
    },
  ];

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Assets"
        subtitle="Track hardware and software across your organization"
        actions={<Button icon={<Plus size={16} />} onClick={() => setModal('new')}>Add Asset</Button>}
      />

      <PageBody>
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatTile label="Total" value={<span className="tabular-nums">{statsData?.total ?? 0}</span>} icon={<Package size={15} />} />
          <StatTile label="Active" value={<span className="tabular-nums">{statsData?.active ?? 0}</span>} icon={<Activity size={15} />} />
          <StatTile label="In Repair" value={<span className="tabular-nums">{statsData?.inRepair ?? 0}</span>} icon={<Wrench size={15} />} />
          <StatTile label="Retired" value={<span className="tabular-nums">{statsData?.retired ?? 0}</span>} icon={<Archive size={15} />} />
        </div>

        {/* Filters */}
        <Toolbar right={<p className="text-sm text-fg-subtle tabular-nums">{data?.total ?? 0} assets</p>}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search assets…"
            className="flex-1 min-w-[160px] max-w-xs"
          />
          <Select aria-label="Filter by status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          <Select aria-label="Filter by type" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All Types</option>
            {ASSET_TYPES.map(t => <option key={t}>{t}</option>)}
          </Select>
        </Toolbar>

        {/* Table */}
        <Card padding="none" className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={assets}
            rowKey={a => a.id}
            minWidth={640}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<Monitor />}
                title="No assets found"
                description={search || filterStatus || filterType
                  ? 'Nothing matches your current search or filters. Try clearing them.'
                  : 'Add your first asset to start tracking hardware and software.'}
                action={{ label: 'Add Asset', onClick: () => setModal('new') }}
              />
            }
          />
        </Card>

        {/* Modal */}
        {modal && (
          <AssetModal
            asset={modal === 'new' ? undefined : modal}
            users={users}
            onClose={() => setModal(null)}
          />
        )}
      </PageBody>
    </div>
  );
}
