import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface StorageStatus {
  /** Google Drive OAuth is set up on this deployment. */
  configured: boolean;
  connected: boolean;
  provider: 'GOOGLE_DRIVE' | 'CUSTOM_S3' | 'HOSTED_S3' | null;
  connectedEmail: string | null;
  connectedAt: string | null;
  /** Present only when provider === 'CUSTOM_S3'. Never includes credentials. */
  customS3: {
    label: string | null;
    bucket: string | null;
    region: string | null;
    endpoint: string | null;
    prefix: string | null;
  } | null;
  /** Bring-your-own S3 needs nothing from the deployment, so this is always true. */
  customS3Available: boolean;
  hosted: {
    available: boolean;
    quotaBytes: number;
    usedBytes: number;
  };
}

/** One entry per S3-compatible service the connect form offers. */
export interface S3Preset {
  id: string;
  label: string;
  /** `{region}` / `{accountId}` are substituted client-side. Null = ask for the full URL. */
  endpointTemplate: string | null;
  defaultRegion: string;
  forcePathStyle: boolean;
  regionRequired: boolean;
  help: string;
}

export interface CustomS3Input {
  label?: string;
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  prefix?: string;
}

export interface S3TestResult {
  ok: boolean;
  step?: 'write' | 'read' | 'delete';
  error?: string;
}

/** GET /storage/status is MANAGERS-only — callers pass `can.readStorage(role)`. */
export function useStorageStatus(enabled = true) {
  return useQuery<StorageStatus>({
    queryKey: ['storage-status'],
    enabled,
    queryFn: () => api.get('/storage/status').then(r => r.data),
    // A 403 here is a permission answer, not a transient failure — retrying it
    // three times just delays the message the user needs to see.
    retry: (count, err: any) => (err?.response?.status === 403 ? false : count < 2),
  });
}

export interface StorageUsage {
  quotaBytes: number;
  hostedUsedBytes: number;
  remainingBytes: number;
  totalBytes: number;
  totalFiles: number;
  avgFileBytes: number;
  /** "Roughly N more typical files fit in the hosted quota." Null when there
   *  is no quota or no files yet to average from. */
  estRemainingFiles: number | null;
  byEntity: { entityType: string; files: number; bytes: number }[];
  byProvider: { provider: string; files: number; bytes: number }[];
  records: { contacts: number; tickets: number; deals: number; leads: number };
}

/** GET /storage/usage — the storage calculator (MANAGERS-only, like status). */
export function useStorageUsage(enabled = true) {
  return useQuery<StorageUsage>({
    queryKey: ['storage-usage'],
    enabled,
    queryFn: () => api.get('/storage/usage').then(r => r.data),
    retry: (count, err: any) => (err?.response?.status === 403 ? false : count < 2),
  });
}

export function useConnectGoogleDrive() {
  return useMutation({
    mutationFn: () => api.get('/storage/google/connect').then(r => r.data),
    onSuccess: (data: { url: string }) => { window.location.href = data.url; },
  });
}

export function useConnectHostedStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/storage/hosted/connect').then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-status'] }),
  });
}

export function useDisconnectStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/storage').then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-status'] }),
  });
}

/** The S3-compatible services the connect form knows how to fill in. */
export function useS3Presets(enabled = true) {
  return useQuery<{ presets: S3Preset[] }>({
    queryKey: ['s3-presets'],
    queryFn: () => api.get('/storage/s3/presets').then(r => r.data),
    staleTime: Infinity,
    enabled,
  });
}

/**
 * Round-trips a probe object without saving anything, so the customer can
 * check credentials before committing. Returns the result rather than
 * throwing — a failed test is an expected outcome of pressing this button,
 * not an error.
 */
export function useTestCustomS3() {
  return useMutation({
    mutationFn: (body: CustomS3Input) =>
      api.post('/storage/s3/test', body).then(r => r.data as S3TestResult),
  });
}

export function useConnectCustomS3() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomS3Input) => api.post('/storage/s3/connect', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-status'] }),
  });
}
