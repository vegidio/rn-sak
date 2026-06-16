import type { HttpVerb } from './types';
import { setRoute } from './registry';

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
