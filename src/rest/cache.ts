import type { QueryClient } from '@tanstack/react-query';

// Tracks which (QueryClient, apiId) pairs already have an eviction subscriber, so we
// install exactly one. Keyed by QueryClient so it is released when the client is GC'd.
const registry = new WeakMap<QueryClient, Set<string>>();

/**
 * Trim an API's cached query entries down to `maxEntries`. TanStack's `QueryCache` is the source of truth — we only
 * remove the overflow. Eviction targets inactive (unmounted) entries, oldest first, so a mounted query is never ripped
 * out from under a component; `maxEntries` is therefore a soft cap on retained-but-unused entries.
 *
 * Ordering is by `dataUpdatedAt` (last write), an approximate LRU.
 */
export const enforceMaxEntries = (queryClient: QueryClient, apiId: string, maxEntries: number): void => {
    const cache = queryClient.getQueryCache();
    const queries = cache.getAll().filter((q) => q.queryKey[0] === apiId);

    const overflow = queries.length - maxEntries;
    if (overflow <= 0) return;

    const evictable = queries
        .filter((q) => q.getObserversCount() === 0)
        .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);

    for (const q of evictable.slice(0, overflow)) cache.remove(q);
};

/**
 * Install a permanent cache subscriber that enforces `maxEntries` for `apiId` on the given client, idempotently — only
 * the first call per (client, apiId) subscribes. The subscriber reacts only to this API's `added` events (the one
 * count-growing event), and the returned unsubscribe is intentionally discarded.
 */
export const installEviction = (queryClient: QueryClient, apiId: string, maxEntries: number): void => {
    let installed = registry.get(queryClient);
    if (!installed) {
        installed = new Set();
        registry.set(queryClient, installed);
    }
    if (installed.has(apiId)) return;
    installed.add(apiId);

    queryClient.getQueryCache().subscribe((event) => {
        if (event.type === 'added' && event.query.queryKey[0] === apiId) {
            enforceMaxEntries(queryClient, apiId, maxEntries);
        }
    });
    enforceMaxEntries(queryClient, apiId, maxEntries);
};
