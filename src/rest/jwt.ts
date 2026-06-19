// Minimal, dependency-free JWT helpers. Only the `exp` claim is needed (for preemptive refresh), so
// this decodes just the payload — it does NOT verify the signature, which is the server's job.

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode a standard base64 string to its raw bytes-as-string. Falls back when `atob` is absent. */
const base64Decode = (input: string): string => {
    const globalAtob = (globalThis as { atob?: (data: string) => string }).atob;
    if (globalAtob) return globalAtob(input);

    // Manual fallback for runtimes without `atob`.
    const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
    let output = '';
    for (let i = 0; i < clean.length; i += 4) {
        const e0 = B64_ALPHABET.indexOf(clean[i] as string);
        const e1 = B64_ALPHABET.indexOf(clean[i + 1] as string);
        const e2 = B64_ALPHABET.indexOf(clean[i + 2] as string);
        const e3 = B64_ALPHABET.indexOf(clean[i + 3] as string);

        output += String.fromCharCode((e0 << 2) | (e1 >> 4));
        if (e2 !== -1) output += String.fromCharCode(((e1 & 15) << 4) | (e2 >> 2));
        if (e3 !== -1) output += String.fromCharCode(((e2 & 3) << 6) | e3);
    }
    return output;
};

/** Convert base64url (JWT) to standard base64, restoring padding. */
const base64UrlToBase64 = (input: string): string => {
    const replaced = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = replaced.length % 4;
    return pad === 0 ? replaced : replaced + '='.repeat(4 - pad);
};

/**
 * Extract the `exp` claim from a JWT as a Unix timestamp in **milliseconds**, or `undefined` if the token is malformed
 * or carries no numeric `exp`.
 */
export const decodeJwtExp = (token: string): number | undefined => {
    const payload = token.split('.')[1];
    if (!payload) return undefined;

    try {
        const json = base64Decode(base64UrlToBase64(payload));
        const claims = JSON.parse(json) as { exp?: unknown };
        return typeof claims.exp === 'number' ? claims.exp * 1000 : undefined;
    } catch {
        return undefined;
    }
};
