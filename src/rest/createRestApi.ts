import { useEffect } from 'react';
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import type {
    CacheOverride,
    Ctor,
    MethodMeta,
    MutationsOf,
    QueriesOf,
    RequestVars,
    RestApi,
    RestApiConfig,
    RetryPolicy,
} from './types';
import { installEviction } from './cache';
import { createAxios, execute } from './client';
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
 * A query hook's first argument is `vars`, its second is options. With two arguments the
 * split is unambiguous. With one we can't rely on position — a contract method that takes
 * no `vars` collapses its type to `(options?)` — so we sniff the argument's shape: anything
 * carrying a vars-shaped key is treated as `vars`, otherwise as options. (An object mixing
 * both kinds of keys is read as `vars`; pass the two-argument form to combine them.)
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
    (
        client: AxiosInstance,
        apiId: string,
        meta: MethodMeta,
        defaults: RetryPolicy,
        apiTtl?: number,
        maxEntries?: number,
    ) =>
    (arg1?: RequestVars | QueryOptions, arg2?: QueryOptions) => {
        const queryClient = useQueryClient();
        const { vars, options } = resolveQueryArgs(arg1, arg2);
        const { cache: reqCache, ...rest } = options ?? {};

        // `cache: false` disables caching for this call (ignoring the API default);
        // otherwise a per-request ttl wins over the API default. Both map to TanStack's
        // staleTime + gcTime. An explicit staleTime/gcTime in `rest` still wins (spread last).
        let ttlOpts: { staleTime: number; gcTime: number } | Record<string, never> = {};
        if (reqCache === false) {
            ttlOpts = { staleTime: 0, gcTime: 0 };
        } else {
            const effectiveTtl = reqCache?.ttl ?? apiTtl;
            if (effectiveTtl !== undefined) ttlOpts = { staleTime: effectiveTtl, gcTime: effectiveTtl };
        }

        useEffect(() => {
            if (maxEntries === undefined) return;
            installEviction(queryClient, apiId, maxEntries);
        }, [queryClient]);

        return useQuery({
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
 */
export const createRestApi = <T extends object, const Cfg extends RestApiConfig>(
    ApiClass: Ctor<T>,
    config: Cfg,
): RestApi<T, QueriesOf<Cfg>, MutationsOf<Cfg>> => {
    const meta = getClassMeta(ApiClass);
    if (!meta) throw new Error(`No REST metadata found on ${ApiClass.name}. Did the decorators run?`);

    const client = createAxios(config);
    const apiId = ApiClass.name;
    const hooks: Record<string, unknown> = {};

    // Build the default retry policy, omitting unset keys so they don't shadow
    // TanStack's own defaults. A per-hook `retry`/`retryDelay` still wins because
    // the hook factories spread these defaults before the caller's options.
    const defaults: RetryPolicy = {};
    if (config.retry !== undefined) defaults.retry = config.retry;
    if (config.retryDelay !== undefined) defaults.retryDelay = config.retryDelay;

    // Cache policy is query-only; mutations are never cached.
    const apiTtl = config.cache?.ttl;
    const maxEntries = config.cache?.maxEntries;

    for (const methodMeta of meta.values()) {
        const key = `use${pascal(methodMeta.methodName)}`;
        hooks[key] = isQuery(methodMeta, config)
            ? makeQueryHook(client, apiId, methodMeta, defaults, apiTtl, maxEntries)
            : makeMutationHook(client, apiId, methodMeta, defaults);
    }

    return hooks as RestApi<T, QueriesOf<Cfg>, MutationsOf<Cfg>>;
};
