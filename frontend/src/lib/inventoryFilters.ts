import { PAGE_SIZES } from '../components/PaginationFooter';
export { PAGE_SIZES };

export const coreFilterNames = ['q', 'platform', 'status', 'criticality'] as const;
export const advancedFilterNames = [
  'cluster',
  'environment',
  'monitoring_enabled',
  'node',
  'os_family',
  'owner',
  'pmp_enabled',
  'tag',
  'application',
  'ip_role',
  'health',
  'shutdown_stale',
  'decommission_overdue',
  'missing_ip',
  'duplicate_ip',
] as const;
export const filterNames = [...coreFilterNames, ...advancedFilterNames] as const;

export type FilterName = (typeof filterNames)[number];
export type Filters = Record<FilterName, string[]>;

export function emptyFilters(): Filters {
  const result = {} as Filters;
  for (const name of filterNames) {
    result[name] = [];
  }
  return result;
}

export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_STORAGE_KEY = 'inventory-page-size';

export type ViewState = { page: number; size: number; sort: string | null; dir: 'asc' | 'desc' };

// Keys the API accepts (services/vms.py::SORT_COLUMNS). 'health' maps to
// health_score server-side; keeping one list here stops the two from drifting.
export const SORTABLE_COLUMNS = new Set([
  'name', 'status', 'criticality', 'health', 'updated_at',
  'cluster', 'platform', 'environment',
  'cpu_cores', 'memory_mb', 'owner',
]);

function storedPageSize(): number {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  const stored = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
  return PAGE_SIZES.includes(stored as (typeof PAGE_SIZES)[number]) ? stored : DEFAULT_PAGE_SIZE;
}

export function viewFromParams(params: URLSearchParams): ViewState {
  const page = Math.max(1, Number(params.get('page')) || 1);
  const rawSize = Number(params.get('size'));
  const size = PAGE_SIZES.includes(rawSize as (typeof PAGE_SIZES)[number]) ? rawSize : storedPageSize();
  const sort = params.get('sort');
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  return { page, size, sort: sort && SORTABLE_COLUMNS.has(sort) ? sort : null, dir };
}

export function paramsFromFilters(filters: Filters, view: ViewState): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of filterNames) {
    const values = filters[name];
    if (values.length > 0) {
      values.forEach((v) => params.append(name, v));
    }
  }
  if (view.page > 1) params.set('page', String(view.page));
  if (view.size !== DEFAULT_PAGE_SIZE) params.set('size', String(view.size));
  if (view.sort) {
    params.set('sort', view.sort);
    params.set('dir', view.dir);
  }
  return params;
}

// The wire format the API wants: page/size become limit/offset, page/size drop out.
export function queryParamsFor(filters: Filters, view: ViewState): URLSearchParams {
  const params = paramsFromFilters(filters, view);
  params.delete('page');
  params.delete('size');
  params.set('limit', String(view.size));
  params.set('offset', String((view.page - 1) * view.size));
  return params;
}

export function filtersFromParams(params: URLSearchParams): Filters {
  const result = emptyFilters();
  for (const name of filterNames) {
    const values = params.getAll(name);
    if (values.length > 0) {
      result[name as FilterName] = values;
    }
  }
  return result;
}

export function hasActiveFilters(filters: Filters): boolean {
  return filterNames.some((name) => filters[name].length > 0);
}

export function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

export const neutralChipClass =
  'inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] capitalize text-[var(--color-text-secondary)]';