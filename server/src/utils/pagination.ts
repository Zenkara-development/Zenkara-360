import { Request } from 'express';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export function parsePagination(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit as string) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginate<T>(data: T[], total: number, { page, limit }: PaginationParams): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    pagination: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}
