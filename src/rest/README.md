# `rest` — TanStack Query hooks from a decorator REST contract

Define a REST API contract once as a decorated class, pass it to `createRestApi`, and get fully typed [TanStack Query](https://tanstack.com/query) hooks backed by [axios](https://axios-http.com/).

```ts
import { Get, Post, Put, Delete, Path, Query, Body, stub, createRestApi } from 'rn-sak';

interface User { id: string; name: string }
interface CreateUserDto { name: string }

class UserApi {
    @Get('/users')        listUsers(@Query('page') _page: number): User[] { return stub() }
    @Get('/users/:id')    getUser(@Path('id') _id: string): User { return stub() }
    @Post('/users')       createUser(@Body() _body: CreateUserDto): User { return stub() }
    @Put('/users/:id')    updateUser(@Path('id') _id: string, @Body() _body: CreateUserDto): User { return stub() }
    @Delete('/users/:id') deleteUser(@Path('id') _id: string): void { stub() }
}

const api = createRestApi(UserApi, { baseURL: 'https://api.example.com' });

// Inside a component (wrap your app in a TanStack <QueryClientProvider>):
const { data } = api.useGetUser({ params: { id: '42' } });        // data: User | undefined
const create = api.useCreateUser();
create.mutate({ body: { name: 'Alice' } });
```

Each contract method becomes a `use<Method>` hook. `GET` → a `useQuery` hook;
`POST`/`PUT`/`PATCH`/`DELETE` → a `useMutation` hook.

## Request variables

Hooks (queries) and `mutate` (mutations) accept one object:

| Key       | Source decorator | Goes to                          |
| --------- | ---------------- | -------------------------------- |
| `params`  | `@Path('name')`  | `:name` tokens in the URL        |
| `query`   | `@Query('name')` | URL query string                 |
| `body`    | `@Body()`        | request body                     |
| `headers` | `@Header('name')`| request headers                  |

```ts
api.useListUsers({ query: { page: 1 } });
api.useUpdateUser().mutate({ params: { id: '42' }, body: { name: 'Bob' } });
```

## Query keys & invalidation

Query keys are `[ApiClassName, methodName, params, query]`. After any mutation
succeeds, all queries for that API (`[ApiClassName]`) are invalidated. Compose
your own `onSuccess` — it runs in addition to the built-in invalidation.

## Why concrete methods + `stub()`?

The methods are **not** `abstract`: abstract methods emit no JavaScript, so their
decorators never run and no metadata is collected. `stub()` is a typed
placeholder body that is **never executed** (`createRestApi` reads metadata and
builds hooks; it never calls your methods). It exists only so the method keeps
its typed return value. For `void` methods call `stub()` without `return`.

## Query vs mutation typing

Runtime classification always uses the real HTTP verb (`@Get` → query). The
**editor type**, however, cannot see decorators, so it infers query-vs-mutation
from the method name: `get|list|find|fetch|read|search` → query hook, else
mutation hook. For a method whose name disagrees with its verb, override it:

```ts
createRestApi(AuthApi, { baseURL, mutations: ['getToken'] as const });
// also: queries: ['...'] as const
```

## Required consumer setup

Because you author the decorated class in **your** source, your toolchain must
support TypeScript legacy decorators (incl. parameter decorators):

1. **tsconfig.json** — `"experimentalDecorators": true`.
2. **Babel** (Metro) — add these plugins (order matters):
   ```js
   plugins: [
       'babel-plugin-transform-typescript-metadata',
       ['@babel/plugin-proposal-decorators', { version: 'legacy' }],
       ['@babel/plugin-transform-class-properties', { loose: true }],
   ]
   ```
   `legacy` is required — modern TC39 decorators do not support parameter
   decorators. `reflect-metadata` is bundled by `rn-sak` and imported for you.
3. **Biome** (if used) — set
   `"javascript": { "parser": { "unsafeParameterDecoratorsEnabled": true } }`.
4. If you enable `noUnusedParameters`, prefix unused contract params with `_`
   (the decorator string carries the real name).
