import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagInput } from '../components/TagInput';

afterEach(cleanup);

describe('TagInput', () => {
  it('renders existing tags with >=24px pill-remove button and removes on click', async () => {
    const onChange = vi.fn();
    render(<TagInput id="tags" value={['web', 'prod']} options={['web', 'prod', 'staging']} onChange={onChange} />);

    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.getByText('prod')).toBeInTheDocument();

    const removeBtn = screen.getByLabelText('Remove tag web');
    expect(removeBtn).toHaveClass('h-6', 'w-6');

    await userEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith(['prod']);
  });

  it('adds new tags via typing and Enter', async () => {
    const onChange = vi.fn();
    render(<TagInput id="tags" value={['existing']} options={['existing', 'new-tag']} onChange={onChange} />);

    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'database{enter}');
    expect(onChange).toHaveBeenCalledWith(['existing', 'database']);
  });

  it('removes the last tag on Backspace when input is empty', () => {
    const onChange = vi.fn();
    render(<TagInput id="tags" value={['tag1', 'tag2']} options={[]} onChange={onChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['tag1']);
  });
});
