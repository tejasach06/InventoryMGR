import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_STORAGE_KEY,
  paramsFromFilters,
  viewFromParams,
} from '../routes/InventoryPage';
import { emptyFilterState } from '../components/filters/filterConfig';

beforeEach(() => window.localStorage.clear());

describe('inventory URL state', () => {
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
});
