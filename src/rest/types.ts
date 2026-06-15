import type { UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

// --- Runtime metadata ---------------------------------------------------------

export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ParamRole = 'path' | 'query' | 'body' | 'header';

export type ParamMeta = {
    role: ParamRole;
    /** Name for `path`/`query`/`header`; ignored for `body`. */
    name?: string;
    /** Position of the parameter in the method signature. */
    index: number;
};

export type MethodMeta = {
    methodName: string;
    verb: HttpVerb;
    /** Path template, e.g. `/users/:id`. */
    path: string;
    params: ParamMeta[];
};

/** Keyed by method name. */
export type ClassMeta = Map<string, MethodMeta>;

// --- Public surface -----------------------------------------------------------

export type Ctor<T> = new (...args: never[]) => T;

/** Variables passed to a hook (query) or to `mutate` (mutation). */
export type RequestVars = {
    params?: Record<string, string | number>;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
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
};

// --- Type-level hook mapping ---------------------------------------------------

export type QueryHook<R> = (
    vars?: RequestVars,
    options?: Omit<UseQueryOptions<R, Error, R>, 'queryKey' | 'queryFn'>,
) => UseQueryResult<R, Error>;

export type MutationHook<R> = (
    options?: Omit<UseMutationOptions<R, Error, RequestVars>, 'mutationFn'>,
) => UseMutationResult<R, Error, RequestVars>;

type ResultOf<F> = F extends (...args: never[]) => infer R ? R : never;

/** Method-name prefixes that statically map to a query hook. */
type QueryPrefix = 'get' | 'list' | 'find' | 'fetch' | 'read' | 'search';

type IsQueryName<Name extends string> = Lowercase<Name> extends `${QueryPrefix}${string}` ? true : false;

/** `Q`/`M` are unions of explicitly-overridden method names. */
type IsQuery<Name extends string, Q extends string, M extends string> = Name extends Q
    ? true
    : Name extends M
      ? false
      : IsQueryName<Name>;

type HookFor<F, Name extends string, Q extends string, M extends string> =
    IsQuery<Name, Q, M> extends true ? QueryHook<ResultOf<F>> : MutationHook<ResultOf<F>>;

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
