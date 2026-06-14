'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, detailMessage, MempalaceSearchHit } from '../api/client';
import { Alert, Badge, EmptyState, PageHeader, cardClass, helpTextClass, inputClass, labelClass, primaryButtonClass } from '../components/ui';

const DEFAULT_LIMIT = '20';

function paramsForSearch(query: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('limit', DEFAULT_LIMIT);
  return params;
}

export function canSearchMempalace(query: string): boolean {
  return query.trim().length > 0;
}

function ResultCard({ hit }: { hit: MempalaceSearchHit }) {
  return (
    <article className={cardClass + ' space-y-3'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{hit.title}</h2>
          <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{hit.path}:{hit.line}</p>
        </div>
        {hit.page_type ? <Badge value={hit.page_type} /> : null}
      </div>
      <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{hit.snippet}</p>
    </article>
  );
}

export function MempalacePage() {
  const [draftQuery, setDraftQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const trimmedQuery = submittedQuery.trim();
  const queryParams = useMemo(() => paramsForSearch(trimmedQuery), [trimmedQuery]);
  const search = useQuery({
    queryKey: ['mempalace', queryParams.toString()],
    queryFn: () => api.searchMempalace(queryParams),
    enabled: canSearchMempalace(trimmedQuery),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = draftQuery.trim();
    if (canSearchMempalace(nextQuery)) {
      setSubmittedQuery(nextQuery);
    }
  }

  const hasSearched = canSearchMempalace(trimmedQuery);
  const results = search.data?.items ?? [];

  return (
    <section>
      <PageHeader title="MemPalace" eyebrow="Readonly knowledge database" />
      <form className={cardClass + ' mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end'} onSubmit={submit} role="search">
        <div>
          <label className={labelClass} htmlFor="mempalace-query">Search knowledge</label>
          <input
            className={inputClass}
            id="mempalace-query"
            name="q"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Search MemPalace, Proxmox, Devbox…"
            autoComplete="off"
          />
          <p className={helpTextClass}>Searches maintained Markdown pages under the configured readonly LL_wiki vault.</p>
        </div>
        <button className={primaryButtonClass} type="submit" disabled={!canSearchMempalace(draftQuery) || search.isFetching}>
          {search.isFetching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {search.isError ? <Alert>{detailMessage(search.error)}</Alert> : null}
      {!hasSearched ? <EmptyState title="Search the knowledge palace" body="Enter a phrase to retrieve matching wiki pages without modifying the source vault." /> : null}
      {hasSearched && !search.isLoading && !search.isError && results.length === 0 ? (
        <EmptyState title="No matching pages" body="Try a broader concept, entity, source title, or exact phrase from the wiki." />
      ) : null}
      {results.length > 0 ? (
        <div className="space-y-4" aria-label="MemPalace results">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{search.data?.total ?? results.length} pages matched “{search.data?.query ?? trimmedQuery}”.</p>
          {results.map((hit) => <ResultCard key={`${hit.path}:${hit.line}`} hit={hit} />)}
        </div>
      ) : null}
    </section>
  );
}
