export type {
    CacheOverride,
    CachePolicy,
    Ctor,
    HttpVerb,
    MutationHook,
    QueryHook,
    RequestVars,
    RestApi,
    RestApiConfig,
} from './types';
export { createRestApi } from './createRestApi';
export { Delete, Get, Patch, Post, Put } from './decorators';
