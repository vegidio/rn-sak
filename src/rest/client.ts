import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import axios from 'axios';
import type { MethodMeta, RequestVars, RestApiConfig } from './types';

/**
 * Request config carrying the contract metadata, so the auth interceptors can read the originating method's `skipAuth`
 * flag, and a once-only retry marker. axios preserves these extra props through the interceptor chain and onto
 * `error.config`.
 */
export type RequestConfigWithMeta = AxiosRequestConfig & {
    meta?: MethodMeta;
    /** Set once by the response interceptor to enforce the retry-once guard. */
    authRetried?: boolean;
};

export const createAxios = (config: RestApiConfig): AxiosInstance =>
    axios.create({
        baseURL: config.baseURL,
        headers: config.headers,
        ...config.axios,
    });

const PATH_PARAM = /:([A-Za-z0-9_]+)/g;

/** Substitute `:name` tokens in the path template from `vars.params`. */
const applyPath = (template: string, params: RequestVars['params']): string =>
    template.replace(PATH_PARAM, (_match, key: string) => {
        const value = params?.[key];
        if (value === undefined || value === null) throw new Error(`Missing path param ":${key}" for "${template}"`);
        return encodeURIComponent(String(value));
    });

export const buildRequest = (meta: MethodMeta, vars: RequestVars = {}): RequestConfigWithMeta => {
    const request: RequestConfigWithMeta = {
        method: meta.verb,
        url: applyPath(meta.path, vars.params),
        // Tag the request so the auth interceptors can read this method's `skipAuth` flag.
        meta,
    };

    if (vars.query && Object.keys(vars.query).length > 0) request.params = vars.query;
    if (vars.headers) request.headers = vars.headers;
    if (vars.body !== undefined) request.data = vars.body;

    return request;
};

export const execute = async <T>(client: AxiosInstance, meta: MethodMeta, vars: RequestVars): Promise<T> => {
    const response = await client.request<T>(buildRequest(meta, vars));
    return response.data;
};
