import { describe, expect, it, jest } from '@jest/globals';
import type { AxiosAdapter, AxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
// Relative imports so the test, factory, decorators and registry share one module graph (see the
// sibling createRestApi test for why the `rn-sak/rest` subpath is avoided here).
import { createRestApi } from '../createRestApi';
import { Get, Post } from '../decorators';

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

const baseURL = 'https://api.example.com';

class LogApi {
    @Get('/greeting')
    getGreeting!: (vars?: { query?: { lang?: string } }) => { text: string };

    @Post('/greeting')
    createGreeting!: (vars: { body: { text: string } }) => { ok: boolean };
}

// --- helpers -----------------------------------------------------------------

const respond = (config: AxiosRequestConfig, status: number, data: unknown) => {
    const response = { data, status, statusText: status === 200 ? 'OK' : '', headers: {}, config };
    if (status >= 200 && status < 300) return response;
    // Custom adapters must settle non-2xx themselves; throw so the response interceptor sees the error.
    throw new AxiosError(`status ${status}`, String(status), config as never, undefined, response as never);
};

const adapterOf = (status: number, data: unknown = { text: 'Hello!' }): AxiosAdapter =>
    (async (config: AxiosRequestConfig) => respond(config, status, data)) as unknown as AxiosAdapter;

const runQuery = (api: { useGetGreeting: () => unknown }) =>
    (api.useGetGreeting() as { queryFn: () => Promise<unknown> }).queryFn();

const runCreate = (api: { useCreateGreeting: () => unknown }, text: string) =>
    (api.useCreateGreeting() as { mutationFn: (v: { body: { text: string } }) => Promise<unknown> }).mutationFn({
        body: { text },
    });

const joined = (message: jest.Mock): string => message.mock.calls.map((c) => String(c[0])).join('\n');

// --- request logging ----------------------------------------------------------

describe('request/response logging', () => {
    it('emits a request block and a response block for a successful GET', async () => {
        const message = jest.fn();
        const api = createRestApi(LogApi, { baseURL, axios: { adapter: adapterOf(200) }, logging: message });

        await runQuery(api);

        expect(message).toHaveBeenCalledTimes(2);
        const req = String(message.mock.calls[0]?.[0]);
        const res = String(message.mock.calls[1]?.[0]);
        expect(req).toContain('--> GET /greeting');
        expect(req).toContain('--> END GET');
        expect(res).toMatch(/^<-- 200 OK \(\d+ms\)/);
        expect(res).toContain('Hello!');
        expect(res.trimEnd().endsWith('<-- END HTTP')).toBe(true);
    });

    it('logs the serialized body and a Content-Length line for a POST', async () => {
        const message = jest.fn();
        const api = createRestApi(LogApi, {
            baseURL,
            axios: { adapter: adapterOf(200, { ok: true }) },
            logging: message,
        });

        await runCreate(api, 'Hi?');

        const req = String(message.mock.calls[0]?.[0]);
        expect(req).toContain('--> POST /greeting');
        expect(req).toContain('Content-Length: 14'); // {"text":"Hi?"}
        expect(req).toContain('{"text":"Hi?"}');
        expect(req).toContain('--> END POST');
    });

    it('includes the auth-injected Authorization header in the request block', async () => {
        const message = jest.fn();
        const api = createRestApi(LogApi, {
            baseURL,
            axios: { adapter: adapterOf(200) },
            auth: { tokenProvider: () => 'Bearer seed-token' },
            logging: message,
        });

        await runQuery(api);

        expect(String(message.mock.calls[0]?.[0])).toContain('Authorization: Bearer seed-token');
    });

    it('logs an error response with its status', async () => {
        const message = jest.fn();
        const api = createRestApi(LogApi, { baseURL, axios: { adapter: adapterOf(500) }, logging: message });

        await expect(runQuery(api)).rejects.toThrow();

        expect(message).toHaveBeenCalledTimes(2);
        expect(joined(message)).toContain('<-- 500');
    });

    it('logs a query string on the request line', async () => {
        const message = jest.fn();
        const api = createRestApi(LogApi, { baseURL, axios: { adapter: adapterOf(200) }, logging: message });

        await (
            api.useGetGreeting({ query: { lang: 'en' } }) as unknown as { queryFn: () => Promise<unknown> }
        ).queryFn();

        expect(String(message.mock.calls[0]?.[0])).toContain('--> GET /greeting?lang=en');
    });

    it('does not log when no logging config is set', async () => {
        const message = jest.fn();
        const api = createRestApi(LogApi, { baseURL, axios: { adapter: adapterOf(200) } });

        await runQuery(api);

        expect(message).not.toHaveBeenCalled();
    });
});
