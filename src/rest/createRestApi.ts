import { useEffect } from 'react';
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import type {
    CacheOverride,
    CachePolicy,
    Ctor,
    MethodMeta,
    MutationsOf,
    QueriesOf,
    RequestVars,
    RestApi,
    RestApiConfig,
    RestApiControls,
    RetryPolicy,
    SetHeaders,
} from './types';
import { installAuth } from './auth';
import { installEviction } from './cache';
import { createAxios, execute } from './client';
import { installLogging } from './logging';
import { getClassMeta } from './registry';

const pascal = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** Runtime query-vs-mutation: explicit overrides first, then the HTTP verb. */
const isQuery = (meta: MethodMeta, config: RestApiConfig): boolean => {
    if (config.queries?.includes(meta.methodName)) return true;
    if (config.mutations?.includes(meta.methodName)) return false;
    return meta.verb === 'GET';
};

/** Options accepted by a query hook: TanStack query options plus the per-request cache override. */
type QueryOptions = Omit<UseQueryOptions<unknown, Error, unknown>, 'queryKey' | 'queryFn'> & CacheOverride;

/** Keys that mark a query hook argument as request `vars` rather than hook options. */
const VARS_KEYS = ['params', 'query', 'body', 'headers'] as const;

/**
 * A query hook's first argument is `vars`, its second is options. With two arguments, the split is unambiguous. With
 * one, we can't rely on position — a contract method that takes no `vars` collapses its type to `(options?)` — so we
 * sniff the argument's shape: anything carrying a vars-shaped key is treated as `vars`, otherwise as options. (An
 * object mixing both kinds of keys is read as `vars`; pass the two-argument form to combine them.)
 */
const resolveQueryArgs = (
    arg1?: RequestVars | QueryOptions,
    arg2?: QueryOptions,
): { vars: RequestVars; options?: QueryOptions } => {
    if (arg2 !== undefined) return { vars: (arg1 as RequestVars) ?? {}, options: arg2 };
    if (arg1 && typeof arg1 === 'object' && VARS_KEYS.some((key) => key in arg1)) {
        return { vars: arg1 as RequestVars };
    }
    return { vars: {}, options: arg1 as QueryOptions | undefined };
};

const makeQueryHook =
    (client: AxiosInstance, apiId: string, meta: MethodMeta, defaults: RetryPolicy, cache?: CachePolicy) =>
    (arg1?: RequestVars | QueryOptions, arg2?: QueryOptions) => {
        const queryClient = useQueryClient();
        const { vars, options } = resolveQueryArgs(arg1, arg2);
        const { cache: reqCache, ...rest } = options ?? {};

        // Per-request `cache` overrides the API default: `false` disables caching, a `ttl`
        // wins over `cache.ttl`. The chosen ttl maps to TanStack's staleTime + gcTime; an
        // explicit staleTime/gcTime in `rest` still wins (spread last).
        const effectiveTtl = reqCache === false ? 0 : (reqCache?.ttl ?? cache?.ttl);
        const ttlOpts: Partial<Pick<UseQueryOptions<unknown, Error, unknown>, 'staleTime' | 'gcTime'>> =
            effectiveTtl !== undefined ? { staleTime: effectiveTtl, gcTime: effectiveTtl } : {};

        // apiId/cache are stable for this hook's lifetime, so the effect only needs to re-run when the client changes —
        // those values are deliberately omitted from the deps.
        useEffect(() => {
            if (cache?.maxEntries === undefined) return;
            installEviction(queryClient, apiId, cache.maxEntries);
        }, [queryClient]);

        return useQuery({
            // Cache key is params+query only; `headers`/`body` are intentionally excluded, so a query whose result
            // varies by those will collide. (See README "Query keys & invalidation".)
            queryKey: [apiId, meta.methodName, vars.params ?? null, vars.query ?? null],
            queryFn: () => execute<unknown>(client, meta, vars),
            ...defaults,
            ...ttlOpts,
            ...rest,
        });
    };

const makeMutationHook = (client: AxiosInstance, apiId: string, meta: MethodMeta, defaults: RetryPolicy) => {
    const mutationFn = (vars: RequestVars) => execute<unknown>(client, meta, vars);
    return (options?: Omit<UseMutationOptions<unknown, Error, RequestVars>, 'mutationFn'>) => {
        const queryClient = useQueryClient();
        const { onSuccess, ...rest } = options ?? {};

        return useMutation({
            mutationFn,
            ...defaults,
            ...rest,
            onSuccess: (...args) => {
                // Broadly invalidate this API's queries; we can't statically know
                // which GET a mutation affects. Compose with any user onSuccess.
                void queryClient.invalidateQueries({ queryKey: [apiId] });
                return onSuccess?.(...args);
            },
        });
    };
};

/**
 * Turn a decorator-annotated REST contract class into TanStack Query hooks.
 *
 * @example
 * const api = createRestApi(UserApi, { baseURL: 'https://api.example.com' });
 * const { data } = api.useGetUser({ params: { id: '42' } });
 * api.useCreateUser().mutate({ body: { name: 'Alice' } });
 *
 * // Update default headers after creation; every hook picks them up automatically.
 * api.setHeaders({ Authorization: 'Bearer …' });
 */
export const createRestApi = <T extends object, const Cfg extends RestApiConfig>(
    ApiClass: Ctor<T>,
    config: Cfg,
): RestApi<T, QueriesOf<Cfg>, MutationsOf<Cfg>> & RestApiControls => {
    const meta = getClassMeta(ApiClass);
    if (!meta) throw new Error(`No REST metadata found on ${ApiClass.name}. Did the decorators run?`);

    const client = createAxios(config);
    const apiId = ApiClass.name;
    const hooks: Record<string, unknown> = {};

    // Install logging before auth: axios runs request interceptors LIFO, so the logging request interceptor
    // (registered first) runs last and logs the auth-injected Authorization header; on the response side it
    // logs each refresh-and-retry attempt as its own request/response pair.
    if (config.logging) installLogging(client, config.logging);

    // Install auth interceptors only when there's something to inject or refresh; otherwise leave the
    // request pipeline untouched. `close` tears down the preemptive timer (no-op when not configured).
    const auth = config.auth;
    const { close } =
        auth && (auth.tokenProvider || auth.tokenRefresher) ? installAuth(client, auth) : { close: () => {} };

    // Build the default retry policy, omitting unset keys so they don't shadow
    // TanStack's own defaults. A per-hook `retry`/`retryDelay` still wins because
    // the hook factories spread these defaults before the caller's options.
    const defaults: RetryPolicy = {};
    if (config.retry !== undefined) defaults.retry = config.retry;
    if (config.retryDelay !== undefined) defaults.retryDelay = config.retryDelay;

    for (const methodMeta of meta.values()) {
        const key = `use${pascal(methodMeta.methodName)}`;
        hooks[key] = isQuery(methodMeta, config)
            ? // Cache policy is query-only; mutations are never cached.
              makeQueryHook(client, apiId, methodMeta, defaults, config.cache)
            : makeMutationHook(client, apiId, methodMeta, defaults);
    }

    // Patch the shared axios instance's common headers. Every hook closes over this
    // same `client`, so the change applies to all subsequent requests. A per-request
    // `vars.headers` still wins (axios merges request config over the defaults).
    const setHeaders: SetHeaders = (headers) => {
        const common = client.defaults.headers.common;
        for (const [key, value] of Object.entries(headers)) {
            if (value === undefined) delete common[key];
            else common[key] = value;
        }
    };

    return Object.assign(hooks, { setHeaders, close }) as RestApi<T, QueriesOf<Cfg>, MutationsOf<Cfg>> &
        RestApiControls;
};
