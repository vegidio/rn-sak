export type {
    Ctor,
    HttpVerb,
    MutationHook,
    ParamRole,
    QueryHook,
    RequestVars,
    RestApi,
    RestApiConfig,
} from './types';
export { createRestApi } from './createRestApi';
export { Body, Delete, Get, Header, Patch, Path, Post, Put, Query, stub } from './decorators';
