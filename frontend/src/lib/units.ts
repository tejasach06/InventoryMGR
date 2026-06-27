export function formatMemory(memoryMb: number): string {
  const gb = memoryMb / 1024;
  const rounded = Math.round(gb * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} GB`;
}

export function formatDiskSize(gb: number): string {
  if (gb >= 1024 && gb % 1024 === 0) return `${gb / 1024} TB`;
  return `${gb} GB`;
}

export function formatDisks(diskGb: number[]): string {
  if (!diskGb.length) return '—';
  return diskGb.map(formatDiskSize).join(', ');
}
