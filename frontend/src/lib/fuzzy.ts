// Ranked match: exact-prefix, then substring by position, then subsequence.
export function fuzzyFilter(options: string[], query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  const scored: Array<{ opt: string; score: number }> = [];
  for (const opt of options) {
    const o = opt.toLowerCase();
    if (o === q) continue; // no point suggesting what is already typed
    const idx = o.indexOf(q);
    if (idx === 0) scored.push({ opt, score: 0 });
    else if (idx > 0) scored.push({ opt, score: 1000 + idx });
    else {
      // subsequence: every query char in order, score = span it took
      let pos = -1;
      let ok = true;
      const start = o.indexOf(q[0]);
      for (const ch of q) {
        pos = o.indexOf(ch, pos + 1);
        if (pos === -1) {
          ok = false;
          break;
        }
      }
      if (ok) scored.push({ opt, score: 2000 + (pos - start) });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.opt.localeCompare(b.opt))
    .slice(0, limit)
    .map((s) => s.opt);
}
