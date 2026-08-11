import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FuzzyMultiSelect } from '../components/FuzzyMultiSelect';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('FuzzyMultiSelect', () => {
  it('opens on focus, filters options, and adds a clicked option with labels', async () => {
    const onChange = vi.fn();
    render(<FuzzyMultiSelect value={[]} options={['linux', 'windows']} labels={{ linux: 'Linux' }} onChange={onChange} placeholder="OS family" />);

    const input = screen.getByPlaceholderText('OS family');
    fireEvent.focus(input);
    expect(await screen.findByRole('button', { name: 'Linux' })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'win' } });
    expect(screen.queryByRole('button', { name: 'Linux' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'windows' }));

    expect(onChange).toHaveBeenCalledWith(['windows']);
  });

  it('supports keyboard open, highlight movement, custom values, escape, and backspace removal', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FuzzyMultiSelect value={['linux']} options={['linux', 'windows']} onChange={onChange} placeholder="Tags" />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await screen.findByRole('button', { name: 'linux' });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith([]);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(await screen.findByRole('button', { name: 'linux' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalledWith(['linux', 'linux']);

    rerender(<FuzzyMultiSelect value={['linux']} options={['linux', 'windows']} onChange={onChange} placeholder="Tags" />);
    const nextInput = screen.getByRole('textbox');
    fireEvent.change(nextInput, { target: { value: 'custom' } });
    expect(await screen.findByText('No matches for "custom" — press Enter to add as custom value')).toBeInTheDocument();
    fireEvent.keyDown(nextInput, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['linux', 'custom']);

    fireEvent.focus(nextInput);
    await screen.findByRole('button', { name: 'linux' });
    fireEvent.keyDown(nextInput, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'linux' })).not.toBeInTheDocument());
  });

  it('removes pills and closes only for outside clicks', async () => {
    const onChange = vi.fn();
    render(<FuzzyMultiSelect value={['linux']} options={['linux']} labels={{ linux: 'Linux' }} onChange={onChange} placeholder="Tags" />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Linux' }));
    expect(onChange).toHaveBeenCalledWith([]);

    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    expect(await screen.findByRole('button', { name: 'Linux' })).toBeInTheDocument();
    fireEvent.mouseDown(input);
    expect(screen.getByRole('button', { name: 'Linux' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Linux' })).not.toBeInTheDocument());
  });

  it('positions the menu above the input when there is not enough space below', async () => {
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 260, bottom: 270, left: 12, right: 212, width: 200, height: 10, x: 12, y: 260, toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240);

    render(<FuzzyMultiSelect value={[]} options={['linux']} onChange={vi.fn()} placeholder="Tags" />);
    fireEvent.focus(screen.getByPlaceholderText('Tags'));

    const option = await screen.findByRole('button', { name: 'linux' });
    expect(option.parentElement).toHaveStyle({ top: '16px', left: '12px', width: '200px' });
    Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true });
  });
});
