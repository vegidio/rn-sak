import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { LoggingPolicy } from './types';

/** Request config carrying the send timestamp, set by the logging request interceptor and read on settle. */
type TimedConfig = InternalAxiosRequestConfig & { logStart?: number };

/**
 * UTF-8 byte length of a string, for the `Content-Length` line. Computed without `TextEncoder`/`Buffer`, neither of
 * which is guaranteed in the React Native runtime: `encodeURIComponent` percent-escapes every non-ASCII byte, and
 * `unescape` turns those back into one character per byte, so the result's length is the UTF-8 byte count.
 */
const utf8Len = (value: string): number => unescape(encodeURIComponent(value)).length;

/** Serialize a body for logging: `undefined` when absent, strings verbatim, everything else as JSON. */
const bodyText = (data: unknown): string | undefined => {
    if (data === undefined || data === null) return undefined;
    if (typeof data === 'string') return data;
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
};

/** Render axios headers (an `AxiosHeaders` instance or a plain object) as `Key: Value` lines, skipping empty values. */
const headerLines = (headers: unknown): string[] => {
    if (!headers || typeof headers !== 'object') return [];
    const source =
        typeof (headers as { toJSON?: () => Record<string, unknown> }).toJSON === 'function'
            ? (headers as { toJSON: () => Record<string, unknown> }).toJSON()
            : (headers as Record<string, unknown>);

    const lines: string[] = [];
    for (const [key, value] of Object.entries(source)) {
        if (value === undefined || value === null || value === '') continue;
        lines.push(`${key}: ${String(value)}`);
    }
    return lines;
};

/** The request target: the path plus a serialized query string when `params` are present. */
const requestTarget = (config: InternalAxiosRequestConfig): string => {
    const url = config.url ?? '';
    const params = config.params as Record<string, unknown> | undefined;
    if (!params || Object.keys(params).length === 0) return url;

    const query = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    return query ? `${url}?${query}` : url;
};

/**
 * Build the OkHttp `BODY`-style request block: the request line, the headers (with a `Content-Length` line synthesized
 * from the body, since axios sets it after the interceptor chain), then the body, then the `--> END` marker.
 */
const formatRequest = (config: InternalAxiosRequestConfig): string => {
    const method = (config.method ?? 'GET').toUpperCase();
    const body = bodyText(config.data);

    const lines = [`--> ${method} ${requestTarget(config)}`, ...headerLines(config.headers)];
    if (body !== undefined) lines.push(`Content-Length: ${utf8Len(body)}`, '', body);
    lines.push(`--> END ${method}`);
    return lines.join('\n');
};

/**
 * Build the OkHttp `BODY`-style response block: the status line with elapsed time, the headers, then the body, then the
 * `<-- END HTTP` marker.
 */
const formatResponse = (response: AxiosResponse, ms: number): string => {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    const body = bodyText(response.data);

    const lines = [`<-- ${response.status}${statusText} (${ms}ms)`, ...headerLines(response.headers)];
    if (body !== undefined) lines.push('', body);
    lines.push('<-- END HTTP');
    return lines.join('\n');
};

/** Build the response block for a failure with no response (network error/timeout/cancel). */
const formatNetworkError = (error: AxiosError): string => `<-- HTTP FAILED: ${error.message}`;

/**
 * Install OkHttp `BODY`-style request/response logging on an axios instance.
 *
 * A request interceptor stamps the send time and emits the request block; a response interceptor emits the response
 * block on both success and failure (a failure with no response — network error/timeout — emits a short `HTTP FAILED`
 * line). Install this before {@link installAuth} so the request interceptor runs last (axios runs request interceptors
 * LIFO) and therefore logs the auth-injected `Authorization` header, and so each refresh-and-retry attempt is logged as
 * its own request/response pair. Stateless — nothing to tear down.
 */
export const installLogging = (client: AxiosInstance, message: LoggingPolicy): void => {
    client.interceptors.request.use((config) => {
        (config as TimedConfig).logStart = Date.now();
        message(formatRequest(config));
        return config;
    });

    const elapsed = (config?: TimedConfig): number => {
        const start = config?.logStart;
        return start === undefined ? 0 : Date.now() - start;
    };

    client.interceptors.response.use(
        (response: AxiosResponse) => {
            message(formatResponse(response, elapsed(response.config as TimedConfig)));
            return response;
        },
        (error: AxiosError) => {
            if (error.response) message(formatResponse(error.response, elapsed(error.config as TimedConfig)));
            else message(formatNetworkError(error));
            return Promise.reject(error);
        },
    );
};
