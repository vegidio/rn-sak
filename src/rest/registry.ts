import type { ClassMeta, HttpVerb, MethodMeta, ParamMeta } from './types';

// Constructor function -> its collected method metadata. Keyed by the class
// constructor, which is an object (functions are objects), so `object` suffices.
const registry = new WeakMap<object, ClassMeta>();

const classMeta = (ctor: object): ClassMeta => {
    let meta = registry.get(ctor);
    if (!meta) {
        meta = new Map();
        registry.set(ctor, meta);
    }
    return meta;
};

const methodMeta = (ctor: object, methodName: string): MethodMeta => {
    const meta = classMeta(ctor);
    let m = meta.get(methodName);
    if (!m) {
        // Parameter decorators run before the method decorator, so either side
        // may create the entry first. Verb/path are filled in by `setRoute`.
        m = { methodName, verb: 'GET', path: '', params: [] };
        meta.set(methodName, m);
    }
    return m;
};

// Method decorators apply to the prototype, so `ctor = target.constructor`.
const ctorOf = (target: object): object => (target as { constructor: object }).constructor;

/** Called by `@Get`/`@Post`/... */
export const setRoute = (target: object, methodName: string, verb: HttpVerb, path: string): void => {
    const m = methodMeta(ctorOf(target), methodName);
    m.verb = verb;
    m.path = path;
};

/** Called by `@Path`/`@Query`/`@Body`/`@Header` (runs before the method decorator). */
export const addParam = (target: object, methodName: string, param: ParamMeta): void => {
    methodMeta(ctorOf(target), methodName).params.push(param);
};

export const getClassMeta = (ctor: object): ClassMeta | undefined => registry.get(ctor);
