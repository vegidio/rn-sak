import { describe, expect, it, jest } from '@jest/globals';
import type { AxiosInstance } from 'axios';
import type { MethodMeta } from '../types';
import { buildRequest, execute } from '../client';
import { createRestApi } from '../createRestApi';
import { Delete, Get, Post, Put } from '../decorators';
import { getClassMeta } from '../registry';

type User = {
    id: string;
    name: string;
};

type CreateUserDto = {
    name: string;
};

// Each endpoint is a function-typed field declaring its request variables as a single typed `vars` object.
// The field is never assigned or read — `createRestApi` reads the decorator metadata and the field's type
// to build hooks — so the definite-assignment `!:` declaration carries no body.
class UserApi {
    @Get('/users')
    listUsers!: (vars?: { query?: { page?: number } }) => User[];

    @Get('/users/:id')
    getUser!: (vars: { params: { id: string } }) => User;

    @Post('/users')
    createUser!: (vars: { body: CreateUserDto }) => User;

    @Put('/users/:id')
    updateUser!: (vars: { params: { id: string }; body: User }) => User;

    @Delete('/users/:id')
    deleteUser!: (vars: { params: { id: string } }) => void;
}

const methodMeta = (name: string): MethodMeta => {
    const m = getClassMeta(UserApi)?.get(name);
    if (!m) throw new Error(`No metadata for ${name}`);
    return m;
};

describe('decorator metadata', () => {
    it('collects verb and path per method', () => {
        const meta = getClassMeta(UserApi);
        expect(meta).toBeDefined();

        expect(meta?.get('getUser')).toMatchObject({ verb: 'GET', path: '/users/:id' });
        expect(meta?.get('listUsers')).toMatchObject({ verb: 'GET', path: '/users' });
        expect(meta?.get('createUser')?.verb).toBe('POST');
        expect(meta?.get('updateUser')?.verb).toBe('PUT');
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
