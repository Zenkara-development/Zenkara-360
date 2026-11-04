import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Eye, CheckCircle } from 'lucide-react';
import {
  PageHeader, PageBody, Card, CardHeader, Button, Field, Input, Textarea,
} from '../shared/components';

interface Branding {
  primaryColor: string;
  logoUrl: string;
  faviconUrl: string;
  companyName: string;
  supportEmail: string;
  portalWelcome: string;
}

const DEFAULT: Branding = {
  primaryColor: '#6366f1',
  logoUrl: '',
  faviconUrl: '',
  companyName: '',
  supportEmail: '',
  portalWelcome: 'Welcome to our support portal',
};

export default function BrandingPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Branding>(DEFAULT);
  const [saved, setSaved] = useState(false);

  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get('/branding').then(r => r.data).catch(() => null),
  });

  useEffect(() => {
    if (data) setForm({ ...DEFAULT, ...data });
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Branding) => api.post('/branding', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branding'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div>
      <PageHeader
        title="Org Branding"
        subtitle="Customize your organization's appearance and portal"
      />

      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Form */}
          <div className="lg:col-span-3 space-y-5">
            <Card className="space-y-4">
              <h2 className="text-[14px] font-semibold text-fg tracking-tight">Brand identity</h2>

              <Field label="Company name">
                <Input
                  value={form.companyName}
                  onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
                />
              </Field>

              <Field label="Primary color" hint="Used across your customer portal's header and buttons.">
                <div className="flex items-center gap-3">
                  {/* A native colour swatch, not a text control — it keeps its own
                      sizing rather than the shared input's. */}
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                    className="w-12 h-10 rounded-input border border-line cursor-pointer"
                  />
                  <Input
                    aria-label="Primary Color"
                    className="flex-1 font-mono tabular-nums"
                    value={form.primaryColor}
                    onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                  />
                </div>
              </Field>

              <Field label="Logo URL" hint="A transparent PNG or SVG works best on the coloured header.">
                <Input
                  aria-label="Logo URL"
                  placeholder="https://…/logo.png"
                  value={form.logoUrl}
                  onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))}
                />
              </Field>

              <Field label="Favicon URL">
                <Input
                  aria-label="Favicon URL"
                  placeholder="https://…/favicon.ico"
                  value={form.faviconUrl}
                  onChange={e => setForm(f => ({ ...f, faviconUrl: e.target.value }))}
                />
              </Field>
            </Card>

            <Card className="space-y-4">
              <h2 className="text-[14px] font-semibold text-fg tracking-tight">Customer portal</h2>

              <Field label="Support email" hint="Shown to customers as the contact address on the portal.">
                <Input
                  type="email"
                  placeholder="support@yourcompany.com"
                  value={form.supportEmail}
                  onChange={e => setForm(f => ({ ...f, supportEmail: e.target.value }))}
                />
              </Field>

              <Field label="Portal welcome message">
                <Textarea
                  aria-label="Portal Welcome Message"
                  rows={3}
                  value={form.portalWelcome}
                  onChange={e => setForm(f => ({ ...f, portalWelcome: e.target.value }))}
                />
              </Field>
            </Card>

            <Button
              size="lg"
              loading={save.isPending}
              icon={saved ? <CheckCircle size={16} /> : undefined}
              onClick={() => save.mutate(form)}
            >
              {saved ? 'Saved' : save.isPending ? 'Saving…' : 'Save branding'}
            </Button>
          </div>

          {/* Live preview */}
          <div className="lg:col-span-2">
            <Card padding="none" className="overflow-hidden sticky top-6">
              <div className="px-4 py-3 border-b border-line-subtle">
                <CardHeader icon={<Eye size={15} />} title="Portal preview" />
              </div>
              <div className="p-4" style={{ '--preview-color': form.primaryColor } as React.CSSProperties}>
                {/* Simulated portal header */}
                <div className="rounded-card overflow-hidden border border-line-subtle">
                  <div className="p-3 flex items-center gap-2" style={{ backgroundColor: form.primaryColor }}>
                    {form.logoUrl ? (
                      <img src={form.logoUrl} alt="Logo" className="h-6 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-6 h-6 bg-white/30 rounded" />
                    )}
                    <span className="text-white font-semibold text-sm">{form.companyName || 'Your Company'}</span>
                  </div>
                  <div className="p-4 bg-surface-sunken text-center">
                    <p className="text-[13px] text-fg-muted">{form.portalWelcome || 'Welcome to our support portal'}</p>
                    {/* The one legitimately colourless button in the app: its fill
                        is whatever colour the admin is previewing, so it has to be
                        an inline style. Everything else comes from <Button>. */}
                    <Button
                      size="sm"
                      className="mt-3 text-white"
                      style={{ backgroundColor: form.primaryColor }}
                    >
                      Submit a Ticket
                    </Button>
                  </div>
                </div>
                {/* Color swatch */}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[form.primaryColor, form.primaryColor + 'cc', form.primaryColor + '44'].map((c, i) => (
                    <div key={i} className="h-8 rounded-card" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <p className="text-[11.5px] text-fg-subtle text-center mt-2 font-mono">{form.primaryColor}</p>
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
