import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface CsatResponse {
  id: string;
  ticketId: string;
  rating: number;
  comment?: string | null;
  submittedAt: string;
  ticket?: { id: string; title: string; status: string };
}

export interface CsatStats {
  total: number;
  avg: number;
  dist: { rating: number; count: number }[];
  satisfactionRate: number;
}

/** Admin-only: list of submitted feedback (GET /csat), see csat.controller.ts's listResponses. */
export const useCsatResponses = (page = 1, enabled = true) =>
  useQuery({
    queryKey: ['csat', page],
    queryFn: () => api.get('/csat', { params: { page, limit: 20 } }).then(r => r.data as { data: CsatResponse[]; total: number; page: number; limit: number }),
    enabled,
  });

/** Admin-only: aggregate satisfaction stats (GET /csat/stats), see csat.controller.ts's csatStats. */
export const useCsatStats = (enabled = true) =>
  useQuery({ queryKey: ['csat-stats'], queryFn: () => api.get('/csat/stats').then(r => r.data as CsatStats), enabled });
