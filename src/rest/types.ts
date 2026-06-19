import type { UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AxiosError, AxiosRequestConfig } from 'axios';

// --- Runtime metadata ---------------------------------------------------------

export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type MethodMeta = {
    methodName: string;
    verb: HttpVerb;
    /** Path template, e.g. `/users/:id`. */
    path: string;
    /** Set by `@SkipAuth`: exclude this method from token injection and reactive refresh. */
    skipAuth?: boolean;
};

/** Keyed by method name. */
export type ClassMeta = Map<string, MethodMeta>;

// --- Public surface -----------------------------------------------------------

export type Ctor<T> = new (...args: never[]) => T;

/**
 * Loose runtime container for request variables, consumed structurally by the client and hook factories. Each contract
 * method declares its own precise `vars` shape; this type is the runtime erasure of all of them.
 */
export type RequestVars = {
    params?: Record<string, string | number>;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
};

/**
 * Default retry behavior for an API. Mirrors TanStack Query's `retry`/`retryDelay` options; the `retry`/`retryDelay`
 * types are compatible between queries and mutations, so a single shape covers both hook kinds. Any value set here is a
 * default that a per-hook `retry`/`retryDelay` option overrides.
 */
export type RetryPolicy = Pick<UseQueryOptions<unknown, Error, unknown>, 'retry' | 'retryDelay'>;

/**
 * Default in-memory cache policy for an API. `ttl` (ms) maps to TanStack Query's `staleTime` and `gcTime`; `maxEntries`
 * caps how many inactive (unmounted) cached query entries are retained per API, enforced by approximate-LRU eviction.
 */
export type CachePolicy = { ttl?: number; maxEntries?: number };

/**
 * Per-request cache override carried on a query hook's options. Set a `ttl` to override the API default for that call,
 * or `false` to disable caching entirely for that call (ignoring the API default). `maxEntries` stays API-wide.
 */
export type CacheOverride = { cache?: false | Pick<CachePolicy, 'ttl'> };

/**
 * Automatic authentication policy. When set, the API installs axios interceptors that inject a token on every request
 * (skippable per method with `@SkipAuth`) and transparently refresh it when a request fails because the token expired.
 *
 * The token value is written to the `Authorization` header verbatim, so the callbacks decide the scheme: return
 * `"Bearer <jwt>"`, `"Token <x>"`, or a raw credential — whatever the API expects.
 */
export type AuthPolicy = {
    /**
     * Supplies the current `Authorization` header value (including any scheme, e.g. `Bearer <jwt>`), used to seed the
     * in-memory token on the first request. Once seeded, `tokenRefresher` is the source of later tokens. May be sync or
     * async.
     */
    tokenProvider?: () => string | undefined | Promise<string | undefined>;
    /**
     * Performs the token refresh and returns the new `Authorization` header value, or `undefined` if the refresh
     * failed. The library caches the returned value and retries the original request with it.
     */
    tokenRefresher?: () => Promise<string | undefined>;
    /**
     * Milliseconds before the JWT's `exp` to refresh proactively. Omit (or `0`) to disable. Requires `tokenRefresher`.
     * Integrates with React Native `AppState`: the timer is cleared while the app is backgrounded and re-evaluated when
     * it returns to the foreground.
     */
    preemptiveRefresh?: number;
    /**
     * What counts as an auth failure that should trigger a refresh. A list of HTTP status codes matched against
     * `error.response.status`, or a predicate over the `AxiosError`. Defaults to `[401]`.
     */
    refreshOn?: number[] | ((error: AxiosError) => boolean);
};

export type RestApiConfig = {
    baseURL: string;
    /** Default headers applied to every request. */
    headers?: Record<string, string>;
    /** Extra axios options merged into the created instance. */
    axios?: AxiosRequestConfig;
    /**
     * Method names to force to mutation hooks at both the type and runtime level,
     * overriding the name-prefix heuristic. Use `as const` for the type override.
     */
    mutations?: readonly string[];
    /** Method names to force to query hooks. Use `as const`. */
    queries?: readonly string[];
    /**
     * Default retry policy applied to every query and mutation hook of this API.
     * Overridable per call via the hook's `retry`/`retryDelay` option.
     */
    retry?: RetryPolicy['retry'];
    retryDelay?: RetryPolicy['retryDelay'];
    /**
     * Default cache policy applied to every query hook of this API. `cache.ttl`
     * (ms) is overridable per call via the hook's `cache` option; `cache.maxEntries`
     * is API-wide. Mutations are never cached.
     */
    cache?: CachePolicy;
    /**
     * Automatic authentication: token injection and refresh-on-failure. When omitted, no auth
     * interceptors are installed and request behavior is unchanged.
     */
    auth?: AuthPolicy;
};

/** Patch the API's runtime default headers. A value of `undefined` removes that header. */
export type SetHeaders = (headers: Record<string, string | undefined>) => void;

/**
 * Imperative controls returned alongside the hooks. `close` tears down the preemptive-refresh timer
 * and its `AppState` subscription; it is a no-op when preemptive refresh is not configured.
 */
export type RestApiControls = { setHeaders: SetHeaders; close: () => void };

// --- Type-level hook mapping ---------------------------------------------------

/**
 * Query hook. `P` is the contract method's parameter tuple (e.g. `[vars: { params: { id: string } }]`), forwarded
 * verbatim so the hook keeps the exact `vars` shape — including whether it is required or optional — before the
 * trailing TanStack options argument.
 */
export type QueryHook<P extends readonly unknown[], R> = (
    ...args: [...P, options?: Omit<UseQueryOptions<R, Error, R>, 'queryKey' | 'queryFn'> & CacheOverride]
) => UseQueryResult<R, Error>;

/**
 * Mutation hook. Mutation variables are passed to `mutate`, not to the hook, so `V` (the contract method's `vars` type)
 * parameterizes the mutation result.
 */
export type MutationHook<V, R> = (
    options?: Omit<UseMutationOptions<R, Error, V>, 'mutationFn'>,
) => UseMutationResult<R, Error, V>;

type ResultOf<F> = F extends (...args: never[]) => infer R ? R : never;

/** The first parameter of a contract method (its `vars`), or `void` when it takes none. */
// biome-ignore lint/suspicious/noConfusingVoidType: `void` is the correct mutation-variables type — it lets `mutate()` be called with no argument.
type VarsArg<P extends readonly unknown[]> = P extends readonly [infer V, ...unknown[]] ? V : void;

/** Method-name prefixes that statically map to a query hook. */
type QueryPrefix = 'get' | 'list' | 'find' | 'fetch' | 'read' | 'search';

type IsQueryName<Name extends string> = Lowercase<Name> extends `${QueryPrefix}${string}` ? true : false;

/** `Q`/`M` are unions of explicitly overridden method names. */
type IsQuery<Name extends string, Q extends string, M extends string> = Name extends Q
    ? true
    : Name extends M
      ? false
      : IsQueryName<Name>;

type HookFor<F extends (...args: never[]) => unknown, Name extends string, Q extends string, M extends string> =
    IsQuery<Name, Q, M> extends true
        ? QueryHook<Parameters<F>, ResultOf<F>>
        : MutationHook<VarsArg<Parameters<F>>, ResultOf<F>>;

export type QueriesOf<Cfg> = Cfg extends { queries: infer Q extends readonly string[] } ? Q[number] : never;

export type MutationsOf<Cfg> = Cfg extends { mutations: infer M extends readonly string[] } ? M[number] : never;

/** The object of hooks returned by `createRestApi`. */
export type RestApi<T, Q extends string = never, M extends string = never> = {
    [K in keyof T as K extends string
        ? T[K] extends (...args: never[]) => unknown
            ? `use${Capitalize<K>}`
            : never
        : never]: K extends string
        ? T[K] extends (...args: never[]) => unknown
            ? HookFor<T[K], K, Q, M>
            : never
        : never;
};
