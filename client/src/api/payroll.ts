import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export type Category = 'EARNING' | 'DEDUCTION' | 'REIMBURSEMENT' | 'EMPLOYER_CONTRIBUTION';
export type CalcType = 'FIXED' | 'PERCENT' | 'FORMULA';
export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'CUSTOM';

export interface Applicability { departmentIds?: string[]; locationIds?: string[]; designations?: string[]; employmentTypes?: string[]; userIds?: string[] }

export interface SalaryComponent {
  id: string; code: string; name: string; category: Category; calcType: CalcType;
  amount: string | null; percent: string | null; percentOf: string | null; formula: string | null;
  statutory: string | null; statutoryConfig: any; prorate: boolean; taxable: boolean; showOnPayslip: boolean;
  displayOrder: number; isActive: boolean; applicability: Applicability | null;
}
export interface StatutoryPreset { name: string; category: Category; description: string; defaults: any }
export interface ComponentsResponse { components: SalaryComponent[]; statutoryPresets: Record<string, StatutoryPreset>; variables: string[] }

export interface Period { start: string; end: string; daysInPeriod: number; periodFraction: number; label: string }
export interface PayrollCycle {
  id: string; name: string; frequency: Frequency; startWeekday: number | null; anchorDate: string | null; lengthDays: number | null;
  isDefault: boolean; isActive: boolean; currentPeriod: Period; _count?: { salaries: number };
}

export interface Overrides { [code: string]: { amount?: number; percent?: number; formula?: string; enabled?: boolean } }
export interface EmployeeSalary {
  id: string; userId: string; payrollCycleId: string | null; currency: string; ctcAnnual: string | null; overrides: Overrides;
  effectiveFrom: string; isActive: boolean; notes: string | null;
  user: { id: string; name: string; email: string; department?: string | null; avatarUrl?: string | null };
  payrollCycle?: { id: string; name: string; frequency: Frequency } | null;
}

export interface Line { code: string; name: string; category: Category; amount: number | string; basis: string | null; showOnPayslip: boolean; displayOrder: number; adjusted?: boolean; taxable?: boolean }
export interface AttendanceBasis {
  policyGroup?: string; byStatus?: Record<string, number>; lateCount?: number; absentDays?: number; unpaidLeaveDays?: number;
  lateConversion?: { note: string; extraLopDays: number }; futureDaysAssumedPaid?: number; manualCorrections?: number;
}
export interface Preview {
  period: Period;
  inputs: { workingDays: number; paidDays: number; lopDays: number; presentDays: number; leaveDays: number; halfDays: number; overtimeHours: number };
  attendance?: AttendanceBasis | null;
  lines: Line[];
  totals: { earnings: number; deductions: number; reimbursements: number; employerContributions: number; gross: number; net: number };
  warnings: string[];
}

export const CATEGORY_LABEL: Record<Category, string> = { EARNING: 'Earning', DEDUCTION: 'Deduction', REIMBURSEMENT: 'Reimbursement', EMPLOYER_CONTRIBUTION: 'Employer contribution' };

export const useSalaryComponents = () => useQuery<ComponentsResponse>({ queryKey: ['salary-components'], queryFn: () => api.get('/hr/payroll/components').then(r => r.data) });
export const usePayrollCycles = () => useQuery<PayrollCycle[]>({ queryKey: ['payroll-cycles'], queryFn: () => api.get('/hr/payroll/cycles').then(r => r.data) });
export const useEmployeeSalaries = () => useQuery<EmployeeSalary[]>({ queryKey: ['employee-salaries'], queryFn: () => api.get('/hr/payroll/employee-salaries').then(r => r.data) });

export function useSaveComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<SalaryComponent> & { id?: string }) => (id ? api.patch(`/hr/payroll/components/${id}`, data) : api.post('/hr/payroll/components', data)).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salary-components'] }),
  });
}
export function useDeleteComponent() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/hr/payroll/components/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['salary-components'] }) });
}
export function useReorderComponents() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (order: string[]) => api.patch('/hr/payroll/components/reorder', { order }), onSuccess: () => qc.invalidateQueries({ queryKey: ['salary-components'] }) });
}
export function useSaveCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<PayrollCycle> & { id?: string }) => (id ? api.put(`/hr/payroll/cycles/${id}`, data) : api.post('/hr/payroll/cycles', data)).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll-cycles'] }),
  });
}
export function useSaveEmployeeSalary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { userId: string; payrollCycleId?: string | null; currency?: string; ctcAnnual?: number | null; overrides: Overrides; effectiveFrom: string; notes?: string | null }) =>
      api.post('/hr/payroll/employee-salaries', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-salaries'] }),
  });
}
export function usePreview(body: { userId?: string; overrides?: Overrides; ctcAnnual?: number | null; payrollCycleId?: string; on?: string; attendance?: boolean; inputs?: Partial<Preview['inputs']> } | null) {
  return useQuery<Preview>({
    queryKey: ['payroll-preview', body],
    queryFn: () => api.post('/hr/payroll/preview', body).then(r => r.data),
    enabled: !!body,
    placeholderData: prev => prev,
  });
}
