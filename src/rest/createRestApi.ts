import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import type { Ctor, MethodMeta, MutationsOf, QueriesOf, RequestVars, RestApi, RestApiConfig } from './types';
import { createAxios, execute } from './client';
import { getClassMeta } from './registry';

const pascal = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** Runtime query-vs-mutation: explicit overrides first, then the HTTP verb. */
const isQuery = (meta: MethodMeta, config: RestApiConfig): boolean => {
    if (config.queries?.includes(meta.methodName)) return true;
    if (config.mutations?.includes(meta.methodName)) return false;
    return meta.verb === 'GET';
};

const makeQueryHook =
    (client: AxiosInstance, apiId: string, meta: MethodMeta) =>
    (vars: RequestVars = {}, options?: Omit<UseQueryOptions<unknown, Error, unknown>, 'queryKey' | 'queryFn'>) =>
        useQuery({
            queryKey: [apiId, meta.methodName, vars.params ?? null, vars.query ?? null],
            queryFn: () => execute<unknown>(client, meta, vars),
            ...options,
        });

const makeMutationHook = (client: AxiosInstance, apiId: string, meta: MethodMeta) => {
    const mutationFn = (vars: RequestVars) => execute<unknown>(client, meta, vars);
    return (options?: Omit<UseMutationOptions<unknown, Error, RequestVars>, 'mutationFn'>) => {
        const queryClient = useQueryClient();
        const { onSuccess, ...rest } = options ?? {};
        return useMutation({
            mutationFn,
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
    if (!meta) {
        throw new Error(`No REST metadata found on ${ApiClass.name}. Did the decorators run?`);
    }

    const client = createAxios(config);
    const apiId = ApiClass.name;
    const hooks: Record<string, unknown> = {};

    for (const methodMeta of meta.values()) {
        const key = `use${pascal(methodMeta.methodName)}`;
        hooks[key] = isQuery(methodMeta, config)
            ? makeQueryHook(client, apiId, methodMeta)
            : makeMutationHook(client, apiId, methodMeta);
    }

    return hooks as RestApi<T, QueriesOf<Cfg>, MutationsOf<Cfg>>;
};
