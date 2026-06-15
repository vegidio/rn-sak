import type { HttpVerb } from './types';
import { setRoute } from './registry';

type MethodDecorator = (target: object, propertyKey: string) => void;

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

/**
 * @deprecated Declare contract endpoints as function-typed fields instead, which
 * need no body at all:
 *
 *     @Get('/users/:id')
 *     getUser!: (vars: { params: { id: string } }) => User;
 *
 * `stub` was the placeholder body for the older stub-bodied-method style. It is
 * never executed — `createRestApi` reads the decorator metadata and builds hooks,
 * it never calls the contract members — and is kept only for backward compatibility.
 */
// biome-ignore lint/suspicious/noExplicitAny: returns `any` so it is assignable to every declared contract return type
export const stub = (): any => undefined;
