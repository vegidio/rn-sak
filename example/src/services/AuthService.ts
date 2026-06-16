import { createRestApi, Get, Post } from 'rn-sak/rest';
import type { AuthResponse, SignInRequest } from '../types';

class AuthService {
    @Post('/api/v1/auth/signin')
    signIn!: (vars: { body: SignInRequest }) => AuthResponse;

    @Get('/api/v1/auth/refresh')
    getRefreshToken!: () => AuthResponse;
}

export const { useSignIn, useGetRefreshToken } = createRestApi(AuthService, {
    baseURL: 'https://countries.vinicius.io',
});
