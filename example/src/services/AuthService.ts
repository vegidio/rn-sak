import { createRestApi, Get, Post } from 'rn-sak/rest';
import type { AuthResponse, SignInRequest } from '../types';

class AuthService {
    @Post('/api/v1/auth/signin')
    signIn!: (vars: { body: SignInRequest }) => AuthResponse;

    @Get('/api/v1/auth/refresh')
    refresh!: (vars?: { headers?: Record<string, string> }) => AuthResponse;
}

export const { useSignIn, useRefresh } = createRestApi(AuthService, {
    baseURL: 'https://countries.vinicius.io',
    queries: ['refresh'],
    retry: 2,
    retryDelay: 1000,
    cache: { ttl: 30000, maxEntries: 20 },
});
