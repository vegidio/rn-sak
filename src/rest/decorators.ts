// Required at runtime: the Babel transform for TS parameter decorators emits
// `Reflect.metadata(...)` calls, which this polyfill provides. Imported here so
// it loads before any decorated contract class is evaluated by consumers.
import 'reflect-metadata';
import type { HttpVerb, ParamRole } from './types';
import { addParam, setRoute } from './registry';

type MethodDecorator = (target: object, propertyKey: string) => void;
type ParamDecorator = (target: object, propertyKey: string, index: number) => void;

const methodDecorator =
    (verb: HttpVerb) =>
    (path: string): MethodDecorator =>
    (target, propertyKey) => {
        setRoute(target, propertyKey, verb, path);
    };

export const Get = methodDecorator('GET');
export const Post = methodDecorator('POST');
export const Put = methodDecorator('PUT');
export const Patch = methodDecorator('PATCH');
export const Delete = methodDecorator('DELETE');

const namedParamDecorator =
    (role: ParamRole) =>
    (name: string): ParamDecorator =>
    (target, propertyKey, index) => {
        addParam(target, propertyKey, { role, name, index });
    };

export const Path = namedParamDecorator('path');
export const Query = namedParamDecorator('query');
export const Header = namedParamDecorator('header');

export const Body = (): ParamDecorator => (target, propertyKey, index) => {
    addParam(target, propertyKey, { role: 'body', index });
};

/**
 * Placeholder body for contract methods. Never executed — `createRestApi` reads
 * the decorator metadata and builds hooks, it never calls the original methods.
 * Lets the contract keep its typed return values without `return undefined as any`.
 */
// biome-ignore lint/suspicious/noExplicitAny: returns `any` so it is assignable to every declared contract return type
export const stub = (): any => undefined;
