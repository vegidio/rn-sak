import { describe, expect, it } from '@jest/globals';
import { decodeJwtExp } from '../jwt';

const makeJwt = (payload: object): string => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `header.${body}.signature`;
};

describe('decodeJwtExp', () => {
    it('returns the exp claim in milliseconds', () => {
        expect(decodeJwtExp(makeJwt({ exp: 1700000000, sub: 'u1' }))).toBe(1700000000 * 1000);
    });

    it('returns undefined when there is no numeric exp', () => {
        expect(decodeJwtExp(makeJwt({ sub: 'u1' }))).toBeUndefined();
        expect(decodeJwtExp(makeJwt({ exp: 'soon' }))).toBeUndefined();
    });

    it('returns undefined for a malformed token', () => {
        expect(decodeJwtExp('not-a-jwt')).toBeUndefined();
        expect(decodeJwtExp('only.two')).toBeUndefined();
        expect(decodeJwtExp('a.!!!notbase64!!!.c')).toBeUndefined();
    });
});
