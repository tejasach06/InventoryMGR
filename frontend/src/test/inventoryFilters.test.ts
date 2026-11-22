import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_STORAGE_KEY,
  SORTABLE_COLUMNS,
  paramsFromFilters,
  toApiSortKey,
  viewFromParams,
} from '../routes/InventoryPage';
import { emptyFilterState } from '../components/filters/filterConfig';
import { DEFAULT_COLUMNS } from '../lib/columns';

beforeEach(() => window.localStorage.clear());

describe('inventory URL state', () => {
  it('includes every DEFAULT_COLUMNS key in SORTABLE_COLUMNS', () => {
    for (const col of DEFAULT_COLUMNS) {
      expect(SORTABLE_COLUMNS.has(col.key)).toBe(true);
    }
    expect(SORTABLE_COLUMNS.has('health')).toBe(true);
  });

  it('normalizes health_score to health in toApiSortKey', () => {
    expect(toApiSortKey('health_score')).toBe('health');
    expect(toApiSortKey('datacenter')).toBe('datacenter');
  });

  it('round-trips late-enabled sort columns through viewFromParams and paramsFromFilters', () => {
    for (const col of DEFAULT_COLUMNS) {
      const expectedSort = col.key === 'health_score' ? 'health' : col.key;
      const view = viewFromParams(new URLSearchParams(`sort=${col.key}&dir=desc`));
      expect(view.sort).toBe(expectedSort);
      expect(view.dir).toBe('desc');
      const params = paramsFromFilters(emptyFilterState, view);
      expect(params.get('sort')).toBe(expectedSort);
      expect(params.get('dir')).toBe('desc');
    }
  });

  it('normalizes invalid view values and uses the stored valid page size', () => {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, '100');
    expect(viewFromParams(new URLSearchParams('page=-4&sort=not-a-column&dir=sideways'))).toEqual({
      page: 1,
      size: 100,
      sort: null,
      dir: 'asc',
    });
  });

  it('serializes repeated filters and omits default view values', () => {
    const filters = {
      ...emptyFilterState,
      q: ['database'],
      status: ['running', 'powered_off'],
      environment: ['production'],
    };
    const params = paramsFromFilters(filters, {
      page: 1,
      size: DEFAULT_PAGE_SIZE,
      sort: null,
      dir: 'asc',
    });

    expect(params.toString()).toBe(
      'q=database&status=running&status=powered_off&environment=production',
    );
  });

  it('serializes non-default page, size, sort, and direction exactly', () => {
    const params = paramsFromFilters(emptyFilterState, {
      page: 3,
      size: 25,
      sort: 'updated_at',
      dir: 'desc',
    });
    expect(params.toString()).toBe('page=3&size=25&sort=updated_at&dir=desc');
  });

  it('serializes os_family undefined to URL and round-trips via emptyFilterState shape', () => {
    const params = paramsFromFilters(
      { ...emptyFilterState, os_family: ['linux', 'undefined'] },
      { page: 1, size: DEFAULT_PAGE_SIZE, sort: null, dir: 'asc' },
    );
    expect(params.toString()).toBe('os_family=linux&os_family=undefined');
  });
});
