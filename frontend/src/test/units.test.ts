import { describe, it, expect } from 'vitest';
import { formatMemory, formatDiskSize, formatDisks } from '../lib/units';

describe('formatMemory', () => {
  it('converts MB to whole GB', () => {
    expect(formatMemory(8192)).toBe('8 GB');
    expect(formatMemory(12288)).toBe('12 GB');
  });
  it('keeps one decimal for fractional GB', () => {
    expect(formatMemory(1536)).toBe('1.5 GB');
  });
});

describe('formatDiskSize', () => {
  it('shows GB below 1 TB', () => {
    expect(formatDiskSize(40)).toBe('40 GB');
    expect(formatDiskSize(500)).toBe('500 GB');
  });
  it('shows TB for clean multiples of 1024', () => {
    expect(formatDiskSize(1024)).toBe('1 TB');
    expect(formatDiskSize(2048)).toBe('2 TB');
  });
  it('stays GB when not a clean TB multiple', () => {
    expect(formatDiskSize(1536)).toBe('1536 GB');
  });
});

describe('formatDisks', () => {
  it('joins multiple disks with mixed units', () => {
    expect(formatDisks([120, 2048])).toBe('120 GB, 2 TB');
  });
  it('renders a dash for no disks', () => {
    expect(formatDisks([])).toBe('—');
  });
});
