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

| Key       | Type you declare              | Goes to                   |
|-----------|-------------------------------|---------------------------|
| `params`  | `{ <name>: string \| number }`| `:name` tokens in the URL |
| `query`   | `{ <name>: string \| number }`| URL query string          |
| `body`    | your DTO type                 | request body              |
| `headers` | `{ <name>: string }`          | request headers           |

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
