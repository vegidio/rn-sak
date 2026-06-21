# `rest` — TanStack Query hooks from a decorator REST contract

Define a REST API contract once as a decorated class, pass it to `createRestApi`, and get fully typed [TanStack Query](https://tanstack.com/query) hooks backed by [axios](https://axios-http.com/).

```ts
import { Get, Post, Put, Delete, createRestApi } from 'rn-sak/rest';

type User = { id: string; name: string };
type CreateUserDto = { name: string };

class UserApi {
    @Get('/users')        listUsers!: (vars?: { query?: { page?: number } }) => User[];
    @Get('/users/:id')    getUser!: (vars: { params: { id: string } }) => User;
    @Post('/users')       createUser!: (vars: { body: CreateUserDto }) => User;
    @Put('/users/:id')    updateUser!: (vars: { params: { id: string }; body: CreateUserDto }) => User;
    @Delete('/users/:id') deleteUser!: (vars: { params: { id: string } }) => void;
}

const api = createRestApi(UserApi, { baseURL: 'https://api.example.com' });

// Inside a component (wrap your app in a TanStack <QueryClientProvider>):
const { data } = api.useGetUser({ params: { id: '42' } });        // data: User | undefined
const create = api.useCreateUser();
create.mutate({ body: { name: 'Alice' } });

// Each method declares its request variables as a typed `vars` object, so unknown
// keys are a compile error:
api.useGetUser({ params: { id: '42', age: 1 } });                 // ❌ 'age' does not exist
```

Each contract endpoint becomes a `use<Method>` hook. `GET` → a `useQuery` hook;
`POST`/`PUT`/`PATCH`/`DELETE` → a `useMutation` hook.

## Request variables

Each contract endpoint declares a single typed `vars` object. Hooks (queries) and
`mutate` (mutations) accept it; its keys are checked at compile time:

| Key       | Type you declare               | Goes to                   |
|-----------|--------------------------------|---------------------------|
| `params`  | `{ <name>: string \| number }` | `:name` tokens in the URL |
| `query`   | `{ <name>: string \| number }` | URL query string          |
| `body`    | your DTO type                  | request body              |
| `headers` | `{ <name>: string }`           | request headers           |

Declare only the keys an endpoint uses; make `vars` optional (`vars?`) when every
key is optional. The runtime fills `:name` tokens from `params`, sends `query` as
the query string, `body` as the request body, and `headers` as headers — purely by
the shape of `vars`.

```ts
api.useListUsers({ query: { page: 1 } });
api.useUpdateUser().mutate({ params: { id: '42' }, body: { name: 'Bob' } });
```

## Query keys & invalidation

Query keys are `[ApiClassName, methodName, params, query]`. After any mutation
succeeds, all queries for that API (`[ApiClassName]`) are invalidated. Compose
your own `onSuccess` — it runs in addition to the built-in invalidation.

## Authentication

Pass an `auth` config to inject a token on every request and transparently refresh it when a request
fails because the token expired. `tokenProvider` is read **live on every request**, so a token kept in
a reactive store/state/variable is always reflected; you supply it (and the refresh) via callbacks and
never touch headers by hand. The value you return is written to the `Authorization` header **verbatim**,
so you choose the scheme — `Bearer <jwt>`, `Token <x>`, or a raw credential.

```ts
import { createRestApi, Get, Post, SkipAuth } from 'rn-sak/rest';

class Api {
    @SkipAuth @Post('/auth/login')   login!: (vars: { body: Credentials }) => AuthResponse;
    @SkipAuth @Post('/auth/refresh') refresh!: (vars: { body: { refreshToken: string } }) => AuthResponse;
    @Get('/me')                      getMe!: () => User;
}

const api = createRestApi(Api, {
    baseURL: 'https://api.example.com',
    auth: {
        // Read on every request — keep it lightweight (a plain in-memory read). Return the full
        // Authorization value (e.g. "Bearer <jwt>").
        tokenProvider: () => `Bearer ${storage.getAccessToken()}`,

        // Called on an auth failure (default: HTTP 401). Return the NEW Authorization value — the
        // library retries the failed request with it (even though we also persist it below) and keeps
        // it until `tokenProvider` returns a new value. Return `undefined` to signal failure.
        tokenRefresher: async () => {
            const refreshToken = await storage.getRefreshToken();
            if (!refreshToken) return undefined;
            const next = await rawRefresh(refreshToken); // a @SkipAuth call, so it sends no stale token
            await storage.save(next.accessToken, next.refreshToken);
            return `Bearer ${next.accessToken}`;
        },

        preemptiveRefresh: 60_000, // refresh ~60s before the JWT `exp` (omit/0 to disable)
    },
});
```

> `storage` above is **your** persistence (MMKV, SecureStore, AsyncStorage, …) — it is not part of this
> library. `rn-sak` only calls the callbacks; it holds a refreshed token until `tokenProvider` next
> returns a new value.

- **`tokenProvider`** — supplies the `Authorization` value (with scheme), read **live on every request**
  so reactive sources are always reflected. Keep it quick and lightweight — it runs on every request's
  hot path; avoid slow/expensive access (network, disk, secure storage, decryption).
- **`tokenRefresher`** — performs the refresh and returns the new `Authorization` value (or `undefined`
  on failure). The returned value is what retries the failed request, so return it even if you also
  persist it. Concurrent failures share a single refresh (single-flight), and each request is retried
  **at most once** to avoid loops.
- **`preemptiveRefresh`** — milliseconds before the JWT's `exp` to refresh proactively. It is
  React-Native–aware: the timer is cleared while the app is backgrounded (JS timers don't fire
  reliably when suspended) and re-evaluated on return to the foreground, refreshing immediately if the
  token already lapsed. The reactive 401 refresh is always the backstop.
- **`refreshOn`** — what counts as an auth failure. Defaults to `[401]`; pass a list of status codes
  (e.g. `[401, 419]`) or a predicate `(error: AxiosError) => boolean`.

Token injection **always** sets `Authorization` (overriding any per-call `vars.headers.Authorization`)
unless the method is marked `@SkipAuth`. Use `@SkipAuth` for public endpoints (login, signup) and the
refresh endpoint itself — `@SkipAuth` methods are never auto-refreshed, which prevents a failed refresh
from recursing. The decorator composes with the verb decorator in either order.

When `preemptiveRefresh` is set, call `api.close()` (returned alongside the hooks) on teardown to
cancel the background timer and its `AppState` subscription. Without auth configured, `close()` is a
no-op and the request pipeline is untouched.

## Logging

Pass a `logging` config to trace every request and response, mirroring [OkHttp](https://square.github.io/okhttp/features/interceptors/)'s
`HttpLoggingInterceptor` at `BODY` level. You supply a `logging` callback; the library calls it once with
the request block when a request is sent and once with the response block when it settles (error
responses included).

```ts
const api = createRestApi(Api, {
    baseURL: 'https://api.example.com',
    logging: console.log, // or a custom sink
});
```

A `POST /greeting` then prints:

```
--> POST /greeting
Content-Type: plain/text
Content-Length: 3

Hi?
--> END POST

<-- 200 OK (22ms)
Content-Type: plain/text
Content-Length: 6

Hello!
<-- END HTTP
```

- It pairs with `auth`: the logged request block includes the injected `Authorization` header.
- Each refresh-and-retry attempt is logged as its own request/response pair, so a 401 followed by a
  successful retry shows two exchanges.
- A failure with no response (network error, timeout) logs a single `<-- HTTP FAILED: <message>` line.

> `logging` runs on every request — keep it cheap, and gate it behind `__DEV__` (or omit `logging`
> entirely) in production builds.

## Why function-typed fields?

Each endpoint is a **definite-assignment field** (`name!: (vars) => Result`), not
a method. The field is never assigned or read — `createRestApi` reads the decorator
metadata and the field's type to build hooks, it never touches the contract members
— so it needs no body. Fields (unlike `abstract` or `declare` members) still emit
JavaScript, so their decorators run and metadata is collected. The `!` asserts the
field is assigned so `strictPropertyInitialization` stays happy.

## Query vs mutation typing

Runtime classification always uses the real HTTP verb (`@Get` → query). The
**editor type**, however, cannot see method decorators, so it infers
query-vs-mutation from the method name: `get|list|find|fetch|read|search` → query
hook, else mutation hook. For a method whose name disagrees with its verb, override it:

```ts
createRestApi(AuthApi, { baseURL, mutations: ['getToken'] as const });
// also: queries: ['...'] as const
```

## Required consumer setup

Because you author the decorated class in **your** source, your toolchain must
support TypeScript legacy decorators (the `@Get`/`@Post`/... field decorators —
no parameter decorators):

1. **tsconfig.json** — `"experimentalDecorators": true`.
2. **Babel** (Metro) — add these plugins (order matters):
   ```js
   plugins: [
       ['@babel/plugin-proposal-decorators', { version: 'legacy' }],
       ['@babel/plugin-transform-class-properties', { loose: true }],
   ]
   ```
   `legacy` is used for the `@Get`/`@Post`/... decorators. The transform-class-properties
   plugin is what lets the decorators run on the contract fields.
