import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosInstance, AxiosRequestConfig } from 'axios';
import type { MethodMeta } from '../types';
import { enforceMaxEntries } from '../cache';
import { buildRequest, execute } from '../client';
// Imported via relative paths (rather than the `rn-sak/rest` subpath) so the test, the factory, the decorators, the
// registry, and the TanStack mock below all share a single module graph — the subpath resolves to a separate root where
// the mock and the decorator registry would not line up.
import { createRestApi } from '../createRestApi';
import { Delete, Get, Post, Put } from '../decorators';
import { getClassMeta } from '../registry';

// Replace only the TanStack hooks (keep the rest of the module real, e.g. QueryClient) so
// the generated hooks can be invoked outside React and we can assert how options are wired.
jest.mock('@tanstack/react-query', () => ({
    ...jest.requireActual<object>('@tanstack/react-query'),
    useQuery: jest.fn((options: unknown) => options),
    useMutation: jest.fn((options: unknown) => options),
    useQueryClient: jest.fn(() => ({ invalidateQueries: jest.fn() })),
}));

// The query hook calls `useEffect` (to install cache eviction). No-op it so the hooks can
// be invoked outside a React render; eviction itself is tested directly via enforceMaxEntries.
jest.mock('react', () => ({
    ...jest.requireActual<object>('react'),
    useEffect: jest.fn(),
}));

type User = {
    id: string;
    name: string;
};

type CreateUserDto = {
    name: string;
};

// Each endpoint is a function-typed field declaring its request variables as a single typed `vars` object.
// The field is never assigned or read — `createRestApi` reads the decorator metadata and the field's type
// to build hooks — so the definite-assignment `!:` declaration carries no body.
class UserApi {
    @Get('/users')
    listUsers!: (vars?: { query?: { page?: number } }) => User[];

    @Get('/users/:id')
    getUser!: (vars: { params: { id: string } }) => User;

    @Post('/users')
    createUser!: (vars: { body: CreateUserDto }) => User;

    @Put('/users/:id')
    updateUser!: (vars: { params: { id: string }; body: User }) => User;

    @Delete('/users/:id')
    deleteUser!: (vars: { params: { id: string } }) => void;

    // No-vars query method: its hook type collapses to `(options?)`, exercising the
    // single-argument heuristic that routes a lone argument to options instead of vars.
    @Get('/ping')
    ping!: () => { ok: boolean };
}

const methodMeta = (name: string): MethodMeta => {
    const m = getClassMeta(UserApi)?.get(name);
    if (!m) throw new Error(`No metadata for ${name}`);
    return m;
};

describe('decorator metadata', () => {
    it('collects verb and path per method', () => {
        const meta = getClassMeta(UserApi);
        expect(meta).toBeDefined();

        expect(meta?.get('getUser')).toMatchObject({ verb: 'GET', path: '/users/:id' });
        expect(meta?.get('listUsers')).toMatchObject({ verb: 'GET', path: '/users' });
        expect(meta?.get('createUser')?.verb).toBe('POST');
        expect(meta?.get('updateUser')?.verb).toBe('PUT');
        expect(meta?.get('deleteUser')?.verb).toBe('DELETE');
    });
});

describe('buildRequest', () => {
    it('substitutes path params and routes the verb', () => {
        expect(buildRequest(methodMeta('getUser'), { params: { id: '42' } })).toMatchObject({
            method: 'GET',
            url: '/users/42',
        });
    });

    it('attaches query and body', () => {
        expect(buildRequest(methodMeta('createUser'), { body: { name: 'Alice' } })).toMatchObject({
            method: 'POST',
            url: '/users',
            data: { name: 'Alice' },
        });
    });

    it('throws when a required path param is missing', () => {
        expect(() => buildRequest(methodMeta('getUser'))).toThrow(/Missing path param ":id"/);
    });
});

describe('execute', () => {
    it('unwraps response.data', async () => {
        const request = jest.fn(async () => ({ data: { id: '42', name: 'Bob' } }));
        const client = { request } as unknown as AxiosInstance;

        const result = await execute<User>(client, methodMeta('getUser'), { params: { id: '42' } });

        expect(result).toEqual({ id: '42', name: 'Bob' });
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: '/users/42' }));
    });
});

describe('createRestApi', () => {
    it('exposes a use<Method> hook per contract method', () => {
        const api = createRestApi(UserApi, { baseURL: 'https://api.example.com' });

        for (const name of ['useListUsers', 'useGetUser', 'useCreateUser', 'useUpdateUser', 'useDeleteUser']) {
            expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
        }
    });
});

describe('retry policy', () => {
    it('applies the API-level retry policy as a default to query hooks', () => {
        const api = createRestApi(UserApi, { baseURL: 'https://api.example.com', retry: 5, retryDelay: 1000 });

        const options = api.useGetUser({ params: { id: '1' } }) as unknown as Record<string, unknown>;

        expect(options.retry).toBe(5);
        expect(options.retryDelay).toBe(1000);
    });

    it('applies the API-level retry policy as a default to mutation hooks', () => {
        const api = createRestApi(UserApi, { baseURL: 'https://api.example.com', retry: 5 });

        const options = api.useCreateUser() as unknown as Record<string, unknown>;

        expect(options.retry).toBe(5);
    });

    it('lets a per-hook retry option override the API-level default', () => {
        const api = createRestApi(UserApi, { baseURL: 'https://api.example.com', retry: 5 });

        const queryOptions = api.useGetUser({ params: { id: '1' } }, { retry: false }) as unknown as Record<
            string,
            unknown
        >;
        const mutationOptions = api.useCreateUser({ retry: 1 }) as unknown as Record<string, unknown>;

        expect(queryOptions.retry).toBe(false);
        expect(mutationOptions.retry).toBe(1);
    });

    it('omits retry options when no policy is configured, deferring to TanStack defaults', () => {
        const api = createRestApi(UserApi, { baseURL: 'https://api.example.com' });

        const options = api.useGetUser({ params: { id: '1' } }) as unknown as Record<string, unknown>;

        expect('retry' in options).toBe(false);
        expect('retryDelay' in options).toBe(false);
    });
});

describe('cache policy', () => {
    const baseURL = 'https://api.example.com';

    it('maps the API-level cache.ttl to staleTime and gcTime', () => {
        const api = createRestApi(UserApi, { baseURL, cache: { ttl: 60000 } });

        const options = api.useGetUser({ params: { id: '1' } }) as unknown as Record<string, unknown>;

        expect(options.staleTime).toBe(60000);
        expect(options.gcTime).toBe(60000);
    });

    it('lets a per-request cache.ttl override the API-level default', () => {
        const api = createRestApi(UserApi, { baseURL, cache: { ttl: 60000 } });

        const options = api.useGetUser({ params: { id: '1' } }, { cache: { ttl: 5000 } }) as unknown as Record<
            string,
            unknown
        >;

        expect(options.staleTime).toBe(5000);
        expect(options.gcTime).toBe(5000);
    });

    it('disables caching for a request via `cache: false`, ignoring the API default', () => {
        const api = createRestApi(UserApi, { baseURL, cache: { ttl: 60000 } });

        const options = api.useGetUser({ params: { id: '1' } }, { cache: false }) as unknown as Record<string, unknown>;

        expect(options.staleTime).toBe(0);
        expect(options.gcTime).toBe(0);
    });

    it('does not forward the custom `cache` key into the useQuery options', () => {
        const api = createRestApi(UserApi, { baseURL, cache: { ttl: 60000 } });

        const options = api.useGetUser({ params: { id: '1' } }, { cache: { ttl: 5000 } }) as unknown as Record<
            string,
            unknown
        >;

        expect('cache' in options).toBe(false);
    });

    it('adds no staleTime/gcTime when no cache policy is configured', () => {
        const api = createRestApi(UserApi, { baseURL });

        const options = api.useGetUser({ params: { id: '1' } }) as unknown as Record<string, unknown>;

        expect('staleTime' in options).toBe(false);
        expect('gcTime' in options).toBe(false);
    });

    it('honors ttl: 0 (caching disabled)', () => {
        const api = createRestApi(UserApi, { baseURL, cache: { ttl: 0 } });

        const options = api.useGetUser({ params: { id: '1' } }) as unknown as Record<string, unknown>;

        expect(options.staleTime).toBe(0);
        expect(options.gcTime).toBe(0);
    });
});

describe('default headers', () => {
    const baseURL = 'https://api.example.com';

    // Capture each request axios is about to send, after its own header merge, by
    // standing in for the network adapter. Returns a minimal successful response.
    const captureAdapter = (seen: AxiosRequestConfig[]): AxiosAdapter =>
        (async (config: AxiosRequestConfig) => {
            seen.push(config);
            return { data: { id: '1', name: 'Bob' }, status: 200, statusText: 'OK', headers: {}, config };
        }) as unknown as AxiosAdapter;

    const runQuery = async (api: { useGetUser: (vars: { params: { id: string } }) => unknown }) => {
        const options = api.useGetUser({ params: { id: '1' } }) as { queryFn: () => Promise<unknown> };
        await options.queryFn();
    };

    const headerValue = (config: AxiosRequestConfig | undefined, name: string): unknown => {
        const headers = config?.headers as unknown as { get: (n: string) => unknown } | undefined;
        return headers?.get(name);
    };

    it('applies headers set after creation to subsequent requests', async () => {
        const seen: AxiosRequestConfig[] = [];
        const api = createRestApi(UserApi, { baseURL, axios: { adapter: captureAdapter(seen) } });

        api.setHeaders({ Authorization: 'Bearer token' });
        await runQuery(api);

        expect(headerValue(seen[0], 'Authorization')).toBe('Bearer token');
    });

    it('merges successive setHeaders calls rather than replacing them', async () => {
        const seen: AxiosRequestConfig[] = [];
        const api = createRestApi(UserApi, { baseURL, axios: { adapter: captureAdapter(seen) } });

        api.setHeaders({ Authorization: 'Bearer token' });
        api.setHeaders({ 'X-App': 'rn-sak' });
        await runQuery(api);

        expect(headerValue(seen[0], 'Authorization')).toBe('Bearer token');
        expect(headerValue(seen[0], 'X-App')).toBe('rn-sak');
    });

    it('removes a header when its value is undefined', async () => {
        const seen: AxiosRequestConfig[] = [];
        const api = createRestApi(UserApi, { baseURL, axios: { adapter: captureAdapter(seen) } });

        api.setHeaders({ Authorization: 'Bearer token' });
        api.setHeaders({ Authorization: undefined });
        await runQuery(api);

        expect(headerValue(seen[0], 'Authorization')).toBeUndefined();
    });

    it('lets a per-request header override a runtime default', async () => {
        const seen: AxiosRequestConfig[] = [];
        const api = createRestApi(UserApi, { baseURL, axios: { adapter: captureAdapter(seen) } });

        api.setHeaders({ Authorization: 'Bearer default' });
        // `getUser`'s contract declares no per-request headers, but they are supported at
        // runtime (buildRequest forwards vars.headers); cast to exercise the override path.
        const vars = { params: { id: '1' }, headers: { Authorization: 'Bearer override' } };
        const options = api.useGetUser(vars as { params: { id: string } }) as unknown as {
            queryFn: () => Promise<unknown>;
        };
        await options.queryFn();

        expect(headerValue(seen[0], 'Authorization')).toBe('Bearer override');
    });

    it('applies runtime headers to mutation hooks too', async () => {
        const seen: AxiosRequestConfig[] = [];
        const api = createRestApi(UserApi, { baseURL, axios: { adapter: captureAdapter(seen) } });

        api.setHeaders({ Authorization: 'Bearer token' });
        const options = api.useCreateUser() as unknown as {
            mutationFn: (vars: { body: CreateUserDto }) => Promise<unknown>;
        };
        await options.mutationFn({ body: { name: 'Alice' } });

        expect(headerValue(seen[0], 'Authorization')).toBe('Bearer token');
    });
});

describe('query argument heuristic', () => {
    const baseURL = 'https://api.example.com';

    it('routes a lone options-shaped argument to options for a no-vars method', () => {
        // `ping` has no query-name prefix, so mark it a query explicitly for the type level.
        const api = createRestApi(UserApi, { baseURL, queries: ['ping'] });

        const options = api.usePing({ retry: 9, cache: false }) as unknown as Record<string, unknown>;

        expect(options.retry).toBe(9); // routed to options, not swallowed as vars
        expect(options.staleTime).toBe(0); // cache: false took effect
        expect(options.gcTime).toBe(0);
        expect(options.queryKey).toEqual(['UserApi', 'ping', null, null]);
    });

    it('defaults to empty vars when a no-vars method is called with no argument', () => {
        const api = createRestApi(UserApi, { baseURL, queries: ['ping'] });

        const options = api.usePing() as unknown as Record<string, unknown>;

        expect(options.queryKey).toEqual(['UserApi', 'ping', null, null]);
    });

    it('treats a lone vars-shaped argument as vars', () => {
        const api = createRestApi(UserApi, { baseURL });

        const options = api.useListUsers({ query: { page: 2 } }) as unknown as Record<string, unknown>;

        expect(options.queryKey).toEqual(['UserApi', 'listUsers', null, { page: 2 }]);
        expect('retry' in options).toBe(false);
    });

    it('keeps the explicit (vars, options) form unambiguous', () => {
        const api = createRestApi(UserApi, { baseURL });

        const options = api.useListUsers({ query: { page: 2 } }, { cache: false }) as unknown as Record<
            string,
            unknown
        >;

        expect(options.queryKey).toEqual(['UserApi', 'listUsers', null, { page: 2 }]);
        expect(options.staleTime).toBe(0);
        expect(options.gcTime).toBe(0);
    });
});

describe('maxEntries eviction', () => {
    let queryClient: QueryClient;

    // Clear so the queries' gc timers don't keep the Jest process alive.
    afterEach(() => queryClient.clear());

    const seed = (apiId: string, count: number) => {
        for (let i = 0; i < count; i++) {
            queryClient.setQueryData([apiId, 'getUser', String(i), null], { id: String(i) });
        }
    };

    const countFor = (apiId: string) =>
        queryClient
            .getQueryCache()
            .getAll()
            .filter((q) => q.queryKey[0] === apiId).length;

    it('evicts inactive entries down to the cap', () => {
        queryClient = new QueryClient();
        seed('UserApi', 5);

        enforceMaxEntries(queryClient, 'UserApi', 2);

        expect(countFor('UserApi')).toBe(2);
    });

    it('is a no-op when the entry count is at or below the cap', () => {
        queryClient = new QueryClient();
        seed('UserApi', 2);

        enforceMaxEntries(queryClient, 'UserApi', 5);

        expect(countFor('UserApi')).toBe(2);
    });

    it('only evicts entries for the target API', () => {
        queryClient = new QueryClient();
        seed('UserApi', 4);
        seed('OtherApi', 3);

        enforceMaxEntries(queryClient, 'UserApi', 1);

        expect(countFor('UserApi')).toBe(1);
        expect(countFor('OtherApi')).toBe(3);
    });
});
