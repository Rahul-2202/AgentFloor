import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** The signed-in person, from a verified Supabase access token. */
export interface User {
  id: string;
  email: string | null;
  githubLogin: string | null;
  name: string | null;
}

export type Verify = (token: string) => Promise<User>;

export class AuthError extends Error {}

/**
 * Verifies Supabase access tokens against the project's signing keys (JWKS),
 * so no shared secret is needed. Pass `keys` to use a local key set in tests.
 */
export function makeVerifier(opts: { jwksUrl: string; issuer: string; keys?: JWTVerifyGetKey }): Verify {
  const keys = opts.keys ?? createRemoteJWKSet(new URL(opts.jwksUrl));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, { issuer: opts.issuer, audience: "authenticated" });
      if (!payload.sub) throw new AuthError("token has no subject");
      const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" ? v : null);
      return {
        id: payload.sub,
        email: str(payload.email),
        githubLogin: str(meta.user_name),
        name: str(meta.full_name) ?? str(meta.name),
      };
    } catch (err) {
      throw err instanceof AuthError ? err : new AuthError((err as Error).message);
    }
  };
}

/** The token from an `Authorization: Bearer <token>` header, if any. */
export function bearer(header: string | undefined): string | null {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
