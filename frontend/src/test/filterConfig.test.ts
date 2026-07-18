import { describe, expect, it } from 'vitest';
import {
  advancedFilterConfig,
  advancedFilterLabels,
  chipTypeFor,
  coreFilters,
  dynamicFilterNames,
  emptyFilterState,
  filterGroups,
  presetFilters,
} from '../components/filters/filterConfig';
import { advancedFilterNames, filterNames } from '../routes/InventoryPage';

describe('filterConfig', () => {
  it('has a label and a config entry for every non-search filter', () => {
    const nonSearch = filterNames.filter((n) => n !== 'q');
    for (const name of nonSearch) {
      expect(advancedFilterConfig[name], `config for ${name}`).toBeDefined();
      expect(advancedFilterLabels[name], `label for ${name}`).toBeTruthy();
    }
  });

  it('places every non-search filter in exactly one drawer group', () => {
    const grouped = filterGroups.flatMap((g) => g.filters);
    const nonSearch = filterNames.filter((n) => n !== 'q');
    expect([...grouped].sort()).toEqual([...nonSearch].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('lists the three core filters and they are multiSelect enums', () => {
    expect([...coreFilters]).toEqual(['status', 'platform', 'criticality']);
    for (const name of coreFilters) {
      const config = advancedFilterConfig[name];
      expect(config.kind).toBe('multiSelect');
    }
  });

  it('marks exactly the fleet-derived facets as dynamic', () => {
    const dynamic = advancedFilterNames.filter(
      (n) => advancedFilterConfig[n].kind === 'dynamicMultiSelect',
    );
    expect([...dynamic].sort()).toEqual([...dynamicFilterNames].sort());
  });

  it('gives every filter name an empty array in the empty state', () => {
    for (const name of filterNames) {
      expect(emptyFilterState[name]).toEqual([]);
    }
  });

  it('only references known filter names in presets', () => {
    for (const preset of presetFilters) {
      for (const key of Object.keys(preset.filters)) {
        expect(filterNames).toContain(key);
      }
    }
  });

  it('maps filters to semantic chip colours', () => {
    expect(chipTypeFor('environment')).toBe('environment');
    expect(chipTypeFor('os_family')).toBe('os_family');
    expect(chipTypeFor('lifecycle')).toBe('lifecycle');
    expect(chipTypeFor('health')).toBe('status');
    expect(chipTypeFor('owner')).toBe('status');
  });
});
