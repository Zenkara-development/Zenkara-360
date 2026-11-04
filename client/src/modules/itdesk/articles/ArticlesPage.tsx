import { useState, useEffect } from 'react';
import { BookOpen, Plus, Pencil, Trash2, Eye } from 'lucide-react';
import { useArticles, useCreateArticle, useUpdateArticle, useDeleteArticle } from '../../../api/itdesk';
import { useCategories } from '../../../api/itdesk';
import { PageHeader, PageBody, Toolbar, Button, Modal, Badge, EmptyState, SearchInput, SearchableSelect, RowActions, Card, Field, Input, Select, SkeletonCard, RichText, RichTextEditor } from '../../../shared/components';
import { articleStatusVariant } from '../../../shared/components/Badge';
import { formatDistanceToNow } from 'date-fns';
import { useAiPrefill } from '../../../hooks/useAiPrefill';

function ArticleForm({ initial, categories, onSubmit, loading, aiPrefill }: any) {
  const [form, setForm] = useState(initial || { title: '', body: '', categoryId: '', status: 'DRAFT', ...aiPrefill });
  const f = (k: string) => (e: any) => setForm((p: any) => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-3">
      <div className="form-section">
        <p className="form-section-title">Article Details</p>
        <div className="space-y-4">
          <Field label="Title" required htmlFor="article-title">
            <Input id="article-title" required aria-label="Title" value={form.title} onChange={f('title')} placeholder="e.g. How to reset your password" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <SearchableSelect ariaLabel="Category" value={form.categoryId} onChange={val => setForm((p: any) => ({ ...p, categoryId: val }))} options={(categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="Status">
              <SearchableSelect ariaLabel="Status" value={form.status} onChange={val => setForm((p: any) => ({ ...p, status: val }))} required options={['DRAFT','PUBLISHED','ARCHIVED'].map(s => ({ value: s, label: s }))} />
            </Field>
          </div>
        </div>
      </div>
      <div className="form-section">
        <p className="form-section-title">Content <span className="req">*</span></p>
        <Field hint="Markdown formatting is supported">
          <RichTextEditor
            ariaLabel="Body"
            variant="full"
            value={form.body}
            onChange={html => setForm((p: any) => ({ ...p, body: html }))}
            placeholder="Write your article content here — headings, lists, images and links all work…"
            minHeight={220}
          />
        </Field>
      </div>
      <div className="flex justify-end pt-1"><Button type="submit" loading={loading}>{initial ? 'Save Changes' : 'Create Article'}</Button></div>
    </form>
  );
}

function ArticleView({ article }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={articleStatusVariant[article.status]}>{article.status}</Badge>
        {article.category && <Badge variant="blue">{article.category.name}</Badge>}
        <span className="text-xs text-fg-subtle">by {article.author?.name} · {formatDistanceToNow(new Date(article.createdAt), { addSuffix: true })}</span>
      </div>
      <div className="bg-surface-sunken border border-line-subtle rounded-card p-4">
        <RichText content={article.body} />
      </div>
    </div>
  );
}

export function ArticlesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState<null | 'create' | { type: 'edit'; article: any } | { type: 'view'; article: any }>(null);
  const { data: articles, isLoading } = useArticles({ all: '1', ...(statusFilter && { status: statusFilter }) });
  const { data: categories } = useCategories();
  const create = useCreateArticle();
  const update = useUpdateArticle();
  const del = useDeleteArticle();
  const aiPrefill = useAiPrefill<{ title?: string; body?: string; status?: string }>();

  useEffect(() => {
    if (aiPrefill) setModal('create');
  }, [aiPrefill]);

  const filtered = articles?.filter((a: any) => !search || a.title.toLowerCase().includes(search.toLowerCase()));

  async function handleSubmit(form: any) {
    // Only close the modal on success — closing unconditionally in a
    // `finally` here hid real failures (e.g. a validation error) behind
    // what looked like a successful save, with the record silently never
    // created/updated.
    if (modal === 'create') await create.mutateAsync(form);
    else if (modal && typeof modal === 'object' && modal.type === 'edit') await update.mutateAsync({ id: modal.article.id, ...form });
    setModal(null);
  }

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Knowledge Base"
        subtitle={`${filtered?.length ?? 0} articles`}
        actions={<Button icon={<Plus size={15} />} onClick={() => setModal('create')}>New Article</Button>}
        below={
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search articles..." className="w-full sm:w-64" />
            <Select aria-label="Status filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {['DRAFT','PUBLISHED','ARCHIVED'].map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Toolbar>
        }
      />

      <PageBody>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3" aria-hidden="true">
          <SkeletonCard lines={2} /><SkeletonCard lines={2} /><SkeletonCard lines={2} /><SkeletonCard lines={2} />
        </div>
      ) : filtered?.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<BookOpen size={24} />}
            title="No articles yet"
            description={search || statusFilter
              ? 'Nothing matches your current search or filters. Try clearing them.'
              : 'Knowledge base articles help requesters solve common issues themselves. Write your first one.'}
            action={{ label: 'New Article', onClick: () => setModal('create') }}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered?.map((a: any) => (
            <Card key={a.id} data-testid="article-card" padding="sm" className="flex items-start justify-between gap-3 card-hover">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge variant={articleStatusVariant[a.status]}>{a.status}</Badge>
                  {a.category && <Badge variant="blue">{a.category.name}</Badge>}
                </div>
                <h3 className="font-semibold text-fg mb-0.5 truncate" title={a.title}>{a.title}</h3>
                <p className="text-xs text-fg-subtle truncate">by {a.author?.name} · {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</p>
              </div>
              <RowActions items={[
                { label: 'View article', icon: <Eye size={14} />, onClick: () => setModal({ type: 'view', article: a }) },
                { label: 'Edit article', icon: <Pencil size={14} />, onClick: () => setModal({ type: 'edit', article: a }) },
                { label: 'Delete article', icon: <Trash2 size={14} />, onClick: () => del.mutate(a.id), variant: 'danger' },
              ]} />
            </Card>
          ))}
        </div>
      )}
      </PageBody>

      <Modal open={modal === 'create' || (!!modal && typeof modal === 'object' && modal.type === 'edit')}
        onClose={() => setModal(null)}
        title={modal === 'create' ? 'New Article' : 'Edit Article'}
        size="lg">
        <ArticleForm
          initial={modal && typeof modal === 'object' && modal.type === 'edit' ? modal.article : null}
          categories={categories}
          onSubmit={handleSubmit}
          loading={create.isPending || update.isPending}
          aiPrefill={modal === 'create' ? aiPrefill : null}
        />
      </Modal>

      <Modal open={!!modal && typeof modal === 'object' && modal.type === 'view'}
        onClose={() => setModal(null)}
        title={(modal && typeof modal === 'object' && modal.type === 'view') ? modal.article.title : ''}
        size="lg">
        {modal && typeof modal === 'object' && modal.type === 'view' && <ArticleView article={modal.article} />}
      </Modal>
    </div>
  );
}
