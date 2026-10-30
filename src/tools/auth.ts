import type { Auth } from '../types.js';
import { getUserProfile, extractEmail } from '../utils.js';

/**
 * Shared auth helpers for tools that act on behalf of the signed-in user.
 *
 * Auth is read from the FIRST tool-handler argument (`ctx.http.authInfo`, the
 * ServerContext). The access token carries only `sub` + `paypal_merchant_id`
 * (no email), so the buyer's email is resolved from the Auth0 Management API
 * profile looked up by `sub`.
 */

/** Auth0 config needed to resolve the buyer's profile (email) from `sub`. */
export interface AuthConfig {
  domain: string;
  mgmtClientId: string;
  mgmtClientSecret: string;
  /** Canonical tenant Management API audience (custom-domain audience → 403). */
  mgmtAudience?: string;
}

/** Pulls the authenticated `sub` off the handler context, or throws. */
export function requireSub(ctx: unknown): string {
  const authInfo = (ctx as { http?: { authInfo?: Auth } } | undefined)?.http?.authInfo;
  const sub = authInfo?.extra?.sub;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('No authenticated user on the request. Please sign in.');
  }
  return sub;
}

/**
 * Resolves the signed-in user's email from their Auth0 profile.
 *
 * `allowSubFallback` controls the no-email case:
 *  - true  (carts): returns the stable `sub` as a last-resort key so the cart
 *           still works even if the profile has no email.
 *  - false (orders/identity against external APIs): throws, because sending a
 *           `sub` where a real email is expected would query the wrong records.
 */
export async function resolveUserEmail(
  ctx: unknown,
  auth: AuthConfig,
  opts: { allowSubFallback?: boolean } = {},
): Promise<string> {
  const sub = requireSub(ctx);
  const profile = await getUserProfile(
    sub,
    auth.domain,
    auth.mgmtClientId,
    auth.mgmtClientSecret,
    auth.mgmtAudience,
  );
  const email = extractEmail(profile);
  if (email) return email;

  if (opts.allowSubFallback) {
    console.warn(`[auth] No email for sub=${sub}; falling back to sub.`);
    return sub;
  }
  throw new Error("Could not resolve the signed-in user's email from their profile.");
}
