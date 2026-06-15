import { describe, expect, it, jest } from '@jest/globals';
import type { AxiosInstance } from 'axios';
import type { MethodMeta } from '../types';
import { buildRequest, execute } from '../client';
import { createRestApi } from '../createRestApi';
import { Body, Delete, Get, Path, Post, Put, Query, stub } from '../decorators';
import { getClassMeta } from '../registry';

type User = {
    id: string;
    name: string;
};

type CreateUserDto = {
    name: string;
};

// Contract params are unused in the body (decorators carry the real names), so
// they are `_`-prefixed to satisfy `noUnusedParameters`. See README guidance.
class UserApi {
    @Get('/users')
    listUsers(@Query('page') _page: number): User[] {
        return stub();
    }

    @Get('/users/:id')
    getUser(@Path('id') _id: string): User {
        return stub();
    }

    @Post('/users')
    createUser(@Body() _body: CreateUserDto): User {
        return stub();
    }

    @Put('/users/:id')
    updateUser(@Path('id') _id: string, @Body() _body: User): User {
        return stub();
    }

    @Delete('/users/:id')
    deleteUser(@Path('id') _id: string): void {
        // void methods just call stub() (no `return`, to satisfy linters).
        stub();
    }
}

const methodMeta = (name: string): MethodMeta => {
    const m = getClassMeta(UserApi)?.get(name);
    if (!m) throw new Error(`No metadata for ${name}`);
    return m;
};

describe('decorator metadata', () => {
    it('collects verb, path and parameter roles', () => {
        const meta = getClassMeta(UserApi);
        expect(meta).toBeDefined();

        expect(meta?.get('getUser')).toMatchObject({ verb: 'GET', path: '/users/:id' });
        expect(meta?.get('getUser')?.params).toContainEqual({ role: 'path', name: 'id', index: 0 });

        expect(meta?.get('listUsers')?.params).toContainEqual({ role: 'query', name: 'page', index: 0 });

        expect(meta?.get('createUser')?.verb).toBe('POST');
        expect(meta?.get('createUser')?.params).toContainEqual({ role: 'body', index: 0 });

        expect(meta?.get('deleteUser')?.verb).toBe('DELETE');
    });
});

describe('buildRequest', () => {
    it('substitutes path params and routes the verb', () => {
        expect(buildRequest(methodMeta('getUser'), { params: { id: '42' } })).toMatchObject({
            method: 'GET',
            url: '/users/42',
        });
    });

    it('attaches query and body', () => {
        expect(buildRequest(methodMeta('createUser'), { body: { name: 'Alice' } })).toMatchObject({
            method: 'POST',
            url: '/users',
            data: { name: 'Alice' },
        });
    });

    it('throws when a required path param is missing', () => {
        expect(() => buildRequest(methodMeta('getUser'))).toThrow(/Missing path param ":id"/);
    });
});

describe('execute', () => {
    it('unwraps response.data', async () => {
        const request = jest.fn(async () => ({ data: { id: '42', name: 'Bob' } }));
        const client = { request } as unknown as AxiosInstance;

        const result = await execute<User>(client, methodMeta('getUser'), { params: { id: '42' } });

        expect(result).toEqual({ id: '42', name: 'Bob' });
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: '/users/42' }));
    });
});

describe('createRestApi', () => {
    it('exposes a use<Method> hook per contract method', () => {
        const api = createRestApi(UserApi, { baseURL: 'https://api.example.com' });

        for (const name of ['useListUsers', 'useGetUser', 'useCreateUser', 'useUpdateUser', 'useDeleteUser']) {
            expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
        }
    });
});
