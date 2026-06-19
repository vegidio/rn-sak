import type { HttpVerb } from './types';
import { setRoute, setSkipAuth } from './registry';

type MethodDecorator = (target: object, propertyKey: string) => void;

const methodDecorator =
    (verb: HttpVerb) =>
    (path: string): MethodDecorator =>
    (target, propertyKey) =>
        setRoute(target, propertyKey, verb, path);

export const Get = methodDecorator('GET');
export const Post = methodDecorator('POST');
export const Put = methodDecorator('PUT');
export const Patch = methodDecorator('PATCH');
export const Delete = methodDecorator('DELETE');

/**
 * Exclude a contract method from automatic auth: no token is injected, and a failing response is never
 * refreshed/retried. Use it for public endpoints (login, signup) and the refresh endpoint itself (so a failed refresh
 * can't recurse). Compose with the verb decorator in either order.
 */
export const SkipAuth: MethodDecorator = (target, propertyKey) => setSkipAuth(target, propertyKey);
