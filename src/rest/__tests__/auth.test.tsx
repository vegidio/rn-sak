import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
// Relative imports so the test, factory, decorators and registry share one module graph (see the
// sibling createRestApi test for why the `rn-sak/rest` subpath is avoided here).
import { createRestApi } from '../createRestApi';
import { Get, Post, SkipAuth } from '../decorators';

// Keep TanStack real except the hooks, so the generated hooks can be invoked outside React and we can
// drive their queryFn/mutationFn directly.
jest.mock('@tanstack/react-query', () => ({
    ...jest.requireActual<object>('@tanstack/react-query'),
    useQuery: jest.fn((options: unknown) => options),
    useMutation: jest.fn((options: unknown) => options),
    useQueryClient: jest.fn(() => ({ invalidateQueries: jest.fn() })),
}));

jest.mock('react', () => ({
    ...jest.requireActual<object>('react'),
    useEffect: jest.fn(),
}));

// Controllable AppState: tests emit transitions via `__emit` and inspect live listeners via
// `__listenerCount`. All state lives inside the factory (jest.mock is hoisted above imports).
jest.mock('react-native', () => {
    const listeners: Array<(state: string) => void> = [];
    return {
        AppState: {
            currentState: 'active',
            addEventListener: jest.fn((_event: string, handler: (state: string) => void) => {
                listeners.push(handler);
                return {
                    remove: jest.fn(() => {
                        const i = listeners.indexOf(handler);
                        if (i >= 0) listeners.splice(i, 1);
                    }),
                };
            }),
            __emit: (state: string) => {
                for (const handler of [...listeners]) handler(state);
            },
            __listenerCount: () => listeners.length,
        },
    };
});

type MockAppState = {
    currentState: string;
    addEventListener: jest.Mock;
    __emit: (state: string) => void;
    __listenerCount: () => number;
};
const appState = (jest.requireMock('react-native') as { AppState: MockAppState }).AppState;

const baseURL = 'https://api.example.com';

class AuthApi {
    @SkipAuth
    @Post('/login')
    login!: (vars: { body: { user: string } }) => { ok: boolean };

    @Get('/me')
    getMe!: () => { id: string };
}

// --- helpers -----------------------------------------------------------------

const readAuth = (config: AxiosRequestConfig | undefined): unknown => {
    const headers = config?.headers as unknown as { get?: (n: string) => unknown } | undefined;
    return headers?.get ? headers.get('Authorization') : undefined;
};

// Each adapter call is captured as a snapshot — the original config is mutated in place on retry, so a
// live reference would not preserve the per-attempt Authorization header.
type Captured = { authorization: unknown };
type Seen = Captured[];

const respond = (config: AxiosRequestConfig, status: number, data: unknown) => {
    const response = { data, status, statusText: '', headers: {}, config };
    if (status >= 200 && status < 300) return response;
    // Custom adapters must settle non-2xx themselves; throw so the response interceptor sees a 401/etc.
    throw new AxiosError(`status ${status}`, String(status), config as never, undefined, response as never);
};

const adapterOf = (seen: Seen, decide: (config: AxiosRequestConfig) => number): AxiosAdapter =>
    (async (config: AxiosRequestConfig) => {
        seen.push({ authorization: readAuth(config) });
        return respond(config, decide(config), { id: 'me' });
    }) as unknown as AxiosAdapter;

// 401 on the first attempt, 200 once the request has been retried with a refreshed token.
const refreshThenOk = (seen: Seen, failStatus = 401): AxiosAdapter =>
    adapterOf(seen, (c) => ((c as { authRetried?: boolean }).authRetried ? 200 : failStatus));

const always = (seen: Seen, status: number): AxiosAdapter => adapterOf(seen, () => status);

const last = (seen: Seen) => seen[seen.length - 1];

const authOf = (captured: Captured | undefined): unknown => captured?.authorization;

const runQuery = (api: { useGetMe: () => unknown }) =>
    (api.useGetMe() as { queryFn: () => Promise<unknown> }).queryFn();

const runLogin = (api: { useLogin: () => unknown }) =>
    (api.useLogin() as { mutationFn: (v: { body: { user: string } }) => Promise<unknown> }).mutationFn({
        body: { user: 'a' },
    });

// Let pending microtasks (interceptor/refresh promise chains) settle.
const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};

// --- token injection ----------------------------------------------------------

describe('token injection', () => {
    it('injects the seeded bearer token on a normal request', async () => {
        const seen: Seen = [];
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: always(seen, 200) },
            auth: { tokenProvider: () => 'Bearer seed-token' },
        });

        await runQuery(api);

        expect(authOf(last(seen))).toBe('Bearer seed-token');
    });

    it('does not inject a token on a @SkipAuth method', async () => {
        const seen: Seen = [];
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: always(seen, 200) },
            auth: { tokenProvider: () => 'Bearer seed-token' },
        });

        await runLogin(api);

        expect(authOf(last(seen))).toBeUndefined();
    });

    it('awaits an async tokenProvider before sending', async () => {
        const seen: Seen = [];
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: always(seen, 200) },
            auth: { tokenProvider: async () => 'Bearer async-token' },
        });

        await runQuery(api);

        expect(authOf(last(seen))).toBe('Bearer async-token');
    });

    it('reads tokenProvider live on every request (reflects a changed source)', async () => {
        const seen: Seen = [];
        let token = 'Bearer a';
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: always(seen, 200) },
            auth: { tokenProvider: () => token },
        });

        await runQuery(api);
        expect(authOf(last(seen))).toBe('Bearer a');

        token = 'Bearer b';
        await runQuery(api);
        expect(authOf(last(seen))).toBe('Bearer b');
    });

    it('writes the returned value to Authorization verbatim (any scheme)', async () => {
        const seen: Seen = [];
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: always(seen, 200) },
            auth: { tokenProvider: () => 'Token raw-key' },
        });

        await runQuery(api);

        expect(authOf(last(seen))).toBe('Token raw-key');
    });
});

// --- reactive refresh ---------------------------------------------------------

describe('reactive refresh', () => {
    it('refreshes once and retries the original request with the new token', async () => {
        const seen: Seen = [];
        const refresher = jest.fn(async () => 'Bearer new-token');
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: refreshThenOk(seen) },
            auth: { tokenProvider: () => 'Bearer old-token', tokenRefresher: refresher },
        });

        const result = await runQuery(api);

        expect(refresher).toHaveBeenCalledTimes(1);
        expect(seen).toHaveLength(2);
        expect(authOf(seen[0])).toBe('Bearer old-token');
        expect(authOf(seen[1])).toBe('Bearer new-token');
        expect(result).toEqual({ id: 'me' });
    });

    it('keeps a refreshed token for later requests until the provider changes', async () => {
        const seen: Seen = [];
        let token = 'Bearer old-token';
        let calls = 0;
        const refresher = jest.fn(async () => 'Bearer new-token');
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: adapterOf(seen, () => (calls++ === 0 ? 401 : 200)) },
            auth: { tokenProvider: () => token, tokenRefresher: refresher },
        });

        await runQuery(api);
        expect(authOf(seen[1])).toBe('Bearer new-token'); // retry uses refreshed token

        await runQuery(api);
        expect(authOf(last(seen))).toBe('Bearer new-token'); // persists (provider unchanged)

        token = 'Bearer newer-token';
        await runQuery(api);
        expect(authOf(last(seen))).toBe('Bearer newer-token'); // provider change takes over
        expect(refresher).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent refreshes (single-flight)', async () => {
        const seen: Seen = [];
        const refresher = jest.fn(async () => 'Bearer new-token');
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: refreshThenOk(seen) },
            auth: { tokenProvider: () => 'Bearer old-token', tokenRefresher: refresher },
        });

        await Promise.all([runQuery(api), runQuery(api)]);

        expect(refresher).toHaveBeenCalledTimes(1);
        expect(seen).toHaveLength(4); // two originals (401) + two retries (200)
    });

    it('retries at most once, then rejects (no infinite loop)', async () => {
        const seen: Seen = [];
        const refresher = jest.fn(async () => 'Bearer new-token');
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: always(seen, 401) },
            auth: { tokenProvider: () => 'Bearer old-token', tokenRefresher: refresher },
        });

        await expect(runQuery(api)).rejects.toThrow();
        expect(refresher).toHaveBeenCalledTimes(1);
        expect(seen).toHaveLength(2); // original + one retry
    });

    it('rejects with the original error when the refresh fails', async () => {
        const seen: Seen = [];
        const refresher = jest.fn(async () => undefined);
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: always(seen, 401) },
            auth: { tokenProvider: () => 'Bearer old-token', tokenRefresher: refresher },
        });

        await expect(runQuery(api)).rejects.toThrow();
        expect(refresher).toHaveBeenCalledTimes(1);
        expect(seen).toHaveLength(1); // no retry was attempted
    });

    it('does not refresh on a @SkipAuth method', async () => {
        const seen: Seen = [];
        const refresher = jest.fn(async () => 'Bearer new-token');
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: always(seen, 401) },
            auth: { tokenProvider: () => 'Bearer old-token', tokenRefresher: refresher },
        });

        await expect(runLogin(api)).rejects.toThrow();
        expect(refresher).not.toHaveBeenCalled();
        expect(seen).toHaveLength(1);
    });
});

// --- configurable trigger -----------------------------------------------------

describe('configurable trigger', () => {
    it('refreshes on a configured status code', async () => {
        const seen: Seen = [];
        const refresher = jest.fn(async () => 'Bearer new-token');
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: refreshThenOk(seen, 419) },
            auth: { tokenProvider: () => 'Bearer old-token', tokenRefresher: refresher, refreshOn: [419] },
        });

        await runQuery(api);

        expect(refresher).toHaveBeenCalledTimes(1);
        expect(seen).toHaveLength(2);
    });

    it('does not refresh on a status outside the configured list', async () => {
        const seen: Seen = [];
        const refresher = jest.fn(async () => 'Bearer new-token');
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: always(seen, 401) },
            auth: { tokenProvider: () => 'Bearer old-token', tokenRefresher: refresher, refreshOn: [419] },
        });

        await expect(runQuery(api)).rejects.toThrow();
        expect(refresher).not.toHaveBeenCalled();
        expect(seen).toHaveLength(1);
    });

    it('supports a predicate', async () => {
        const seen: Seen = [];
        const refresher = jest.fn(async () => 'Bearer new-token');
        const api = createRestApi(AuthApi, {
            baseURL,
            axios: { adapter: refreshThenOk(seen) },
            auth: {
                tokenProvider: () => 'Bearer old-token',
                tokenRefresher: refresher,
                refreshOn: (error) => error.response?.status === 401,
            },
        });

        await runQuery(api);

        expect(refresher).toHaveBeenCalledTimes(1);
    });
});

// --- preemptive refresh -------------------------------------------------------

describe('preemptive refresh', () => {
    const NOW = 1_000_000;
    // exp 300s out (ms); preemptive 60s before -> timer at NOW + 240_000.
    const makeJwt = (expSeconds: number): string => {
        const body = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
        return `h.${body}.s`;
    };
    const soonToken = makeJwt(NOW / 1000 + 300);
    const farToken = makeJwt(NOW / 1000 + 100_000);

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
        appState.currentState = 'active';
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('refreshes before expiry while foregrounded', async () => {
        const refresher = jest.fn(async () => farToken);
        const api = createRestApi(AuthApi, {
            baseURL,
            auth: { tokenProvider: () => soonToken, tokenRefresher: refresher, preemptiveRefresh: 60_000 },
        });

        await flush(); // eager seed arms the timer
        expect(refresher).not.toHaveBeenCalled();

        jest.advanceTimersByTime(240_000);
        await flush();

        expect(refresher).toHaveBeenCalledTimes(1);
        api.close();
    });

    it('clears the timer while backgrounded', async () => {
        const refresher = jest.fn(async () => farToken);
        const api = createRestApi(AuthApi, {
            baseURL,
            auth: { tokenProvider: () => soonToken, tokenRefresher: refresher, preemptiveRefresh: 60_000 },
        });

        await flush();
        appState.__emit('background');
        jest.advanceTimersByTime(240_000);
        await flush();

        expect(refresher).not.toHaveBeenCalled();
        api.close();
    });

    it('refreshes immediately on resume when the token is already past due', async () => {
        const refresher = jest.fn(async () => farToken);
        const api = createRestApi(AuthApi, {
            baseURL,
            auth: { tokenProvider: () => soonToken, tokenRefresher: refresher, preemptiveRefresh: 60_000 },
        });

        await flush();
        appState.__emit('background'); // drop the pending timer
        jest.setSystemTime(NOW + 250_000); // advance past the (exp - preemptive) mark while suspended
        appState.__emit('active');
        await flush();

        expect(refresher).toHaveBeenCalledTimes(1);
        api.close();
    });

    it('close() removes the AppState subscription and cancels the timer', async () => {
        const refresher = jest.fn(async () => farToken);
        const api = createRestApi(AuthApi, {
            baseURL,
            auth: { tokenProvider: () => soonToken, tokenRefresher: refresher, preemptiveRefresh: 60_000 },
        });

        await flush();
        const before = appState.__listenerCount();
        api.close();

        expect(appState.__listenerCount()).toBe(before - 1);

        jest.advanceTimersByTime(240_000);
        await flush();
        expect(refresher).not.toHaveBeenCalled();
    });
});

// --- no auth configured -------------------------------------------------------

describe('without auth config', () => {
    it('installs no interceptors and exposes a no-op close', async () => {
        const seen: Seen = [];
        const api = createRestApi(AuthApi, { baseURL, axios: { adapter: always(seen, 200) } });

        await runQuery(api);

        expect(authOf(last(seen))).toBeUndefined();
        expect(typeof api.close).toBe('function');
        expect(() => api.close()).not.toThrow();
    });
});
