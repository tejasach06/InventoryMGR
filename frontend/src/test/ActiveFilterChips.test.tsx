import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActiveFilterChips } from '../components/filters/ActiveFilterChips';
import { emptyFilterState } from '../components/filters/filterConfig';

afterEach(cleanup);

describe('ActiveFilterChips', () => {
  it('renders nothing when no filters are set', () => {
    const { container } = render(
      <ActiveFilterChips filters={{ ...emptyFilterState }} onRemove={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores the free-text search filter', () => {
    const { container } = render(
      <ActiveFilterChips filters={{ ...emptyFilterState, q: ['web'] }} onRemove={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one chip per selected value with its human label', () => {
    render(
      <ActiveFilterChips
        filters={{ ...emptyFilterState, status: ['running', 'suspended'], environment: ['production'] }}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('suspended')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(3);
  });

  it('uses the configured display label for boolean filters', () => {
    render(
      <ActiveFilterChips
        filters={{ ...emptyFilterState, monitoring_enabled: ['true'] }}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('reports the filter name and raw value when a chip is dismissed', async () => {
    const onRemove = vi.fn();
    render(
      <ActiveFilterChips
        filters={{ ...emptyFilterState, monitoring_enabled: ['true'] }}
        onRemove={onRemove}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(onRemove).toHaveBeenCalledWith('monitoring_enabled', 'true');
  });
});
