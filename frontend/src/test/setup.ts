import { vi } from 'vitest';

class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly scrollMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  readonly elements: Element[] = [];
  constructor(public callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) { this.elements.push(el); }
  unobserve() {}
  disconnect() { this.elements.length = 0; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
(globalThis as unknown as { MockIntersectionObserver: typeof MockIntersectionObserver }).MockIntersectionObserver = MockIntersectionObserver;
import '@testing-library/jest-dom/vitest';