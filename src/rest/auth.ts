import type { AppStateStatus, EventSubscription } from 'react-native';
import { AppState } from 'react-native';
import type { AxiosError, AxiosInstance, RawAxiosHeaders } from 'axios';
import { AxiosHeaders } from 'axios';
import type { RequestConfigWithMeta } from './client';
import type { AuthPolicy } from './types';
import { decodeJwtExp } from './jwt';

const DEFAULT_REFRESH_STATUS = 401;

/** Whether a failed response should trigger a token refresh, per the configured `refreshOn` policy. */
const isAuthFailure = (error: AxiosError, refreshOn: AuthPolicy['refreshOn']): boolean => {
    if (typeof refreshOn === 'function') return refreshOn(error);
    const statuses = refreshOn ?? [DEFAULT_REFRESH_STATUS];
    const status = error.response?.status;
    return status !== undefined && statuses.includes(status);
};

const setAuthHeader = (config: RequestConfigWithMeta, token: string): void => {
    const headers =
        config.headers instanceof AxiosHeaders
            ? config.headers
            : new AxiosHeaders(config.headers as RawAxiosHeaders | undefined);
    headers.set('Authorization', token);
    config.headers = headers;
};

/**
 * Install token injection and refresh-on-failure on an axios instance.
 *
 * `tokenProvider` is read live on every request, so a token kept in a reactive store/state/variable is
 * always reflected. A token produced by `tokenRefresher`/preemptive refresh overrides that live value
 * until the provider's value next changes (tracked via `lastProvided`), so a just-refreshed token isn't
 * clobbered by a stale read. A request interceptor injects the token (unless the method is `@SkipAuth`);
 * a response interceptor refreshes once and retries on an auth failure, with single-flight dedup and a
 * retry-once guard. With `preemptiveRefresh` set, an `AppState`-aware timer refreshes the token before
 * it expires. Returns a `close` that tears the timer/subscription down.
 */
export const installAuth = (client: AxiosInstance, auth: AuthPolicy): { close: () => void } => {
    const { tokenProvider, tokenRefresher, preemptiveRefresh, refreshOn } = auth;
    const preemptiveEnabled = !!tokenRefresher && !!preemptiveRefresh && preemptiveRefresh > 0;

    let currentToken: string | undefined;
    let lastProvided: string | undefined;
    let refreshPromise: Promise<string | undefined> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let appStateSub: EventSubscription | undefined;
    let isActive = AppState.currentState === 'active';
    let closed = false;

    const clearTimer = (): void => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
    };

    // (Re)schedule the next preemptive refresh from the current token's `exp`. Timers are unreliable in
    // the background, so we only arm one while the app is foregrounded; a past-due token refreshes now.
    const schedulePreemptive = (): void => {
        clearTimer();
        if (!preemptiveEnabled || closed || !isActive || !currentToken) return;

        const exp = decodeJwtExp(currentToken);
        if (exp === undefined) return;

        // Background refreshes are best-effort: swallow failures so they don't surface as unhandled rejections.
        // The reactive 401 refresh remains the backstop.
        const fireRefresh = (): void => void refreshOnce().catch(() => {});

        const delay = exp - (preemptiveRefresh as number) - Date.now();
        if (delay <= 0) {
            fireRefresh();
            return;
        }

        timer = setTimeout(fireRefresh, delay);
    };

    const setToken = (token: string | undefined): void => {
        currentToken = token;
        schedulePreemptive();
    };

    // Single-flight: concurrent auth failures (and preemptive ticks) share one refresh call.
    const refreshOnce = (): Promise<string | undefined> => {
        if (!tokenRefresher) return Promise.resolve(undefined);
        if (!refreshPromise) {
            refreshPromise = Promise.resolve()
                .then(() => tokenRefresher())
                .then((token) => {
                    if (token) setToken(token);
                    return token;
                })
                .finally(() => {
                    refreshPromise = undefined;
                });
        }
        return refreshPromise;
    };

    // Read the live token from `tokenProvider` on every call so a reactive source (store/state/variable)
    // is always reflected. A token set by `tokenRefresher`/preemptive refresh stays in effect until the
    // provider's value actually changes (tracked via `lastProvided`), so a just-refreshed token isn't
    // clobbered by a stale read.
    const resolveToken = async (): Promise<string | undefined> => {
        if (!tokenProvider) return currentToken;
        const live = await tokenProvider();
        if (live !== lastProvided) {
            lastProvided = live;
            setToken(live);
        }
        return currentToken;
    };

    client.interceptors.request.use(async (config) => {
        const meta = (config as RequestConfigWithMeta).meta;
        if (meta?.skipAuth) return config;

        const token = await resolveToken();
        if (token) setAuthHeader(config as RequestConfigWithMeta, token);
        return config;
    });

    client.interceptors.response.use(undefined, async (error: AxiosError) => {
        const config = error.config as RequestConfigWithMeta | undefined;
        if (
            !config ||
            !tokenRefresher ||
            config.meta?.skipAuth ||
            config.authRetried ||
            !isAuthFailure(error, refreshOn)
        ) {
            return Promise.reject(error);
        }

        // Retry-once guard: a still-failing retry rejects instead of looping.
        config.authRetried = true;
        const token = await refreshOnce();
        if (!token) return Promise.reject(error);

        setAuthHeader(config, token);
        return client.request(config);
    });

    // Read eagerly at startup only to arm the preemptive timer before the first request; otherwise the
    // token is resolved live per request.
    if (tokenProvider && preemptiveEnabled) void resolveToken().catch(() => {});

    if (preemptiveEnabled) {
        appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
            if (closed) return;
            isActive = state === 'active';
            // Returning to the foreground self-heals the gap created while suspended; backgrounding
            // drops the (unreliable) pending timer.
            if (isActive) schedulePreemptive();
            else clearTimer();
        });
    }

    return {
        close: () => {
            closed = true;
            clearTimer();
            appStateSub?.remove();
            appStateSub = undefined;
        },
    };
};
