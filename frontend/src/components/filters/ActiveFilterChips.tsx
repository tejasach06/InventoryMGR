'use client';

import { FilterChip } from '../ui';
import type { Filters, FilterName } from '../../routes/InventoryPage';
import { advancedFilterConfig, advancedFilterLabels, chipTypeFor, type AdvancedFilterName } from './filterConfig';

export function ActiveFilterChips({
  filters,
  onRemove,
}: {
  filters: Filters;
  onRemove: (name: AdvancedFilterName, value: string) => void;
}) {
  const chips = (Object.keys(filters) as FilterName[]).flatMap((name) => {
    if (name === 'q') return [];
    const values = filters[name];
    if (values.length === 0) return [];
    const advancedName = name as AdvancedFilterName;
    const fieldLabels = advancedFilterConfig[advancedName].labels;
    return values.map((value) => (
      <FilterChip
        key={`${advancedName}-${value}`}
        label={advancedFilterLabels[advancedName]}
        value={fieldLabels?.[value] ?? value}
        type={chipTypeFor(advancedName)}
        onRemove={() => onRemove(advancedName, value)}
      />
    ));
  });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Active filters">
      {chips}
    </div>
  );
}
