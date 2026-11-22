'use client';

import { RefObject, useEffect, useRef } from 'react';

export interface OverlayFocusOptions {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open overlays, innermost last. Only the top one handles keys; the body scroll lock is
// taken by the first and released by the last, whatever order they close in.
const overlayStack: symbol[] = [];
let bodyOverflowBeforeLock = '';

export function useOverlayFocus({
  open,
  onClose,
  containerRef,
  initialFocusRef,
  closeOnEscape = true,
}: OverlayFocusOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    const token = Symbol('overlay');
    if (overlayStack.length === 0) bodyOverflowBeforeLock = document.body.style.overflow;
    overlayStack.push(token);
    document.body.style.overflow = 'hidden';

    const getFocusables = (): HTMLElement[] => {
      const container = containerRef.current;
      if (!container) return [];
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
      );
    };

    const initialElement = initialFocusRef?.current ?? getFocusables()[0];
    if (initialElement) {
      initialElement.focus();
    } else if (containerRef.current) {
      if (!containerRef.current.hasAttribute('tabindex')) {
        containerRef.current.setAttribute('tabindex', '-1');
      }
      containerRef.current.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (overlayStack[overlayStack.length - 1] !== token) return;
      if (event.key === 'Escape') {
        if (!closeOnEscape) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const items = getFocusables();
      if (items.length === 0) {
        event.preventDefault();
        containerRef.current?.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (!containerRef.current?.contains(active) || active === containerRef.current) {
        event.preventDefault();
        if (event.shiftKey) {
          last.focus();
        } else {
          first.focus();
        }
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      overlayStack.splice(overlayStack.indexOf(token), 1);
      if (overlayStack.length === 0) document.body.style.overflow = bodyOverflowBeforeLock;
      const prev = previousActiveElementRef.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
      previousActiveElementRef.current = null;
    };
  }, [open, containerRef, initialFocusRef, closeOnEscape]);
}
