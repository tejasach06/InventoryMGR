import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { PaginationFooter } from '../components/PaginationFooter';

describe('PaginationFooter', () => {
  it('shows the row range and page count', () => {
    render(<PaginationFooter total={3412} page={3} size={50} onPageChange={vi.fn()} onSizeChange={vi.fn()} />);

    expect(screen.getByText('101–150 of 3,412')).toBeInTheDocument();
    expect(screen.getByText('Page 3 of 69')).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(
      <PaginationFooter total={100} page={1} size={50} onPageChange={vi.fn()} onSizeChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();

    rerender(<PaginationFooter total={100} page={2} size={50} onPageChange={vi.fn()} onSizeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('reports page and size changes', async () => {
    const onPageChange = vi.fn();
    const onSizeChange = vi.fn();
    render(<PaginationFooter total={500} page={2} size={50} onPageChange={onPageChange} onSizeChange={onSizeChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '100');
    expect(onSizeChange).toHaveBeenCalledWith(100);
  });

  it('renders nothing when everything fits on one page', () => {
    const { container } = render(
      <PaginationFooter total={12} page={1} size={50} onPageChange={vi.fn()} onSizeChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
