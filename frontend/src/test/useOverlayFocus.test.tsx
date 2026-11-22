import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOverlayFocus } from '../hooks/useOverlayFocus';

afterEach(cleanup);

function TestOverlayHarness({
  defaultOpen = false,
  withInitialFocus = false,
  closeOnEscape = true,
  onClose = vi.fn(),
}: {
  defaultOpen?: boolean;
  withInitialFocus?: boolean;
  closeOnEscape?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const secondButtonRef = useRef<HTMLButtonElement>(null);

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  useOverlayFocus({
    open,
    onClose: handleClose,
    containerRef,
    initialFocusRef: withInitialFocus ? secondButtonRef : undefined,
    closeOnEscape,
  });

  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Open Modal
      </button>
      {open ? (
        <div ref={containerRef} role="dialog" aria-modal="true" data-testid="dialog">
          <button type="button" data-testid="first-btn">
            First
          </button>
          <button ref={secondButtonRef} type="button" data-testid="second-btn">
            Second
          </button>
          <button type="button" data-testid="third-btn">
            Third
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EmptyOverlayHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useOverlayFocus({
    open,
    onClose: () => {
      setOpen(false);
      onClose();
    },
    containerRef,
  });

  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Open Modal
      </button>
      {open ? (
        <div ref={containerRef} role="dialog" aria-modal="true" data-testid="empty-dialog">
          <p>No interactive elements</p>
        </div>
      ) : null}
    </div>
  );
}

describe('useOverlayFocus', () => {
  it('moves focus to the first focusable element on open when initialFocusRef is omitted', () => {
    render(<TestOverlayHarness />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByTestId('first-btn')).toHaveFocus();
  });

  it('moves focus to initialFocusRef when provided', () => {
    render(<TestOverlayHarness withInitialFocus />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByTestId('second-btn')).toHaveFocus();
  });

  it('traps Tab forward from last element to first element', () => {
    render(<TestOverlayHarness />);
    fireEvent.click(screen.getByTestId('opener'));

    const third = screen.getByTestId('third-btn');
    third.focus();
    expect(third).toHaveFocus();

    fireEvent.keyDown(third, { key: 'Tab' });
    expect(screen.getByTestId('first-btn')).toHaveFocus();
  });

  it('traps Shift+Tab backward from first element to last element', () => {
    render(<TestOverlayHarness />);
    fireEvent.click(screen.getByTestId('opener'));

    const first = screen.getByTestId('first-btn');
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('third-btn')).toHaveFocus();
  });

  it('closes on Escape and restores focus to the previously active element', () => {
    const onClose = vi.fn();
    render(<TestOverlayHarness onClose={onClose} />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByTestId('first-btn')).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId('first-btn'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('does not close on Escape when closeOnEscape is false', () => {
    const onClose = vi.fn();
    render(<TestOverlayHarness closeOnEscape={false} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('opener'));

    fireEvent.keyDown(screen.getByTestId('first-btn'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
  });

  it('focuses container when container has no focusable elements', () => {
    render(<EmptyOverlayHarness />);
    fireEvent.click(screen.getByTestId('opener'));

    const dialog = screen.getByTestId('empty-dialog');
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog).toHaveFocus();
  });

  it('pulls focus back into overlay if active element is outside container', () => {
    render(<TestOverlayHarness />);
    fireEvent.click(screen.getByTestId('opener'));

    // Simulate focus lost to document.body
    document.body.focus();

    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(screen.getByTestId('first-btn')).toHaveFocus();

    document.body.focus();
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('third-btn')).toHaveFocus();
  });
});

describe('stacked overlays', () => {
  function Stack({ onOuter, onInner }: { onOuter: () => void; onInner: () => void }) {
    const outerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [outerOpen, setOuterOpen] = useState(true);
    const [innerOpen, setInnerOpen] = useState(true);
    useOverlayFocus({ open: outerOpen, onClose: () => { setOuterOpen(false); onOuter(); }, containerRef: outerRef });
    useOverlayFocus({ open: innerOpen, onClose: () => { setInnerOpen(false); onInner(); }, containerRef: innerRef });
    return (
      <>
        <button onClick={() => setOuterOpen(false)}>close-outer</button>
        <button onClick={() => setInnerOpen(false)}>close-inner</button>
        {outerOpen && <div ref={outerRef}><button>outer</button></div>}
        {innerOpen && <div ref={innerRef}><button>inner</button></div>}
      </>
    );
  }

  it('Escape closes only the innermost overlay', () => {
    const onOuter = vi.fn();
    const onInner = vi.fn();
    render(<Stack onOuter={onOuter} onInner={onInner} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onInner).toHaveBeenCalledTimes(1);
    expect(onOuter).not.toHaveBeenCalled();
  });

  it('keeps scroll locked until the last overlay closes, in any close order', () => {
    document.body.style.overflow = '';
    render(<Stack onOuter={() => {}} onInner={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByText('close-outer'));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByText('close-inner'));
    expect(document.body.style.overflow).toBe('');
  });
});
