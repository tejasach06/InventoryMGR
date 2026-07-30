import { render, screen, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SectionNav, SectionCard } from '../components/ui';

interface MockObserverInstance {
  callback: IntersectionObserverCallback;
  elements: Element[];
}

function getMockObserverInstances(): MockObserverInstance[] {
  const g = globalThis as unknown as { MockIntersectionObserver?: { instances: MockObserverInstance[] } };
  return g.MockIntersectionObserver?.instances ?? [];
}

describe('SectionNav', () => {
  beforeEach(() => {
    const instances = getMockObserverInstances();
    instances.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  function Component() {
    return (
      <>
        <SectionNav titles={['Identity', 'Location', 'Hardware']} />
        <SectionCard title="Identity">a</SectionCard>
        <SectionCard title="Location">b</SectionCard>
        <SectionCard title="Hardware">c</SectionCard>
      </>
    );
  }

  it('sets initial active link to first title and preserves href slugs', () => {
    render(<Component />);

    const identityLink = screen.getByRole('link', { name: 'Identity' });
    const locationLink = screen.getByRole('link', { name: 'Location' });
    const hardwareLink = screen.getByRole('link', { name: 'Hardware' });

    expect(identityLink).toHaveAttribute('aria-current', 'location');
    expect(locationLink).not.toHaveAttribute('aria-current');
    expect(hardwareLink).not.toHaveAttribute('aria-current');

    expect(identityLink).toHaveAttribute('href', '#identity');
    expect(locationLink).toHaveAttribute('href', '#location');
    expect(hardwareLink).toHaveAttribute('href', '#hardware');
  });

  it('updates active link when intersection observer triggers', () => {
    render(<Component />);

    const instances = getMockObserverInstances();
    expect(instances.length).toBeGreaterThan(0);
    const observer = instances[instances.length - 1];

    const hardwareEl = document.getElementById('hardware');
    expect(hardwareEl).not.toBeNull();

    act(() => {
      observer.callback(
        [
          {
            isIntersecting: true,
            target: hardwareEl!,
            boundingClientRect: { top: 10 } as DOMRectReadOnly,
            intersectionRatio: 1,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: Date.now(),
          },
        ],
        observer as unknown as IntersectionObserver
      );
    });

    const identityLink = screen.getByRole('link', { name: 'Identity' });
    const hardwareLink = screen.getByRole('link', { name: 'Hardware' });

    expect(hardwareLink).toHaveAttribute('aria-current', 'location');
    expect(identityLink).not.toHaveAttribute('aria-current');
  });

  it('retains previous active link when no entries intersect', () => {
    render(<Component />);

    const instances = getMockObserverInstances();
    const observer = instances[instances.length - 1];
    const hardwareEl = document.getElementById('hardware');

    act(() => {
      observer.callback(
        [
          {
            isIntersecting: true,
            target: hardwareEl!,
            boundingClientRect: { top: 10 } as DOMRectReadOnly,
            intersectionRatio: 1,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: Date.now(),
          },
        ],
        observer as unknown as IntersectionObserver
      );
    });

    const hardwareLink = screen.getByRole('link', { name: 'Hardware' });
    expect(hardwareLink).toHaveAttribute('aria-current', 'location');

    act(() => {
      observer.callback(
        [
          {
            isIntersecting: false,
            target: hardwareEl!,
            boundingClientRect: { top: -100 } as DOMRectReadOnly,
            intersectionRatio: 0,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: Date.now(),
          },
        ],
        observer as unknown as IntersectionObserver
      );
    });

    expect(hardwareLink).toHaveAttribute('aria-current', 'location');
  });
});
