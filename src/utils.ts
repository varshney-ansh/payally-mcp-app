export interface UserProfile {
    sub: string;
    name?: string;
    picture?: string;
    email?: string;
}

// Simple in-memory cache for the Management API token to avoid re-fetching on every request.
let mgmtTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Fetches a short-lived Management API token using client credentials.
 * Caches the result until 60 seconds before expiry.
 */
export async function getManagementToken(domain: string, clientId: string, clientSecret: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (mgmtTokenCache && mgmtTokenCache.expiresAt > now + 60) {
        return mgmtTokenCache.token;
    }

    const res = await fetch(`https://${domain}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            audience: `https://${domain}/api/v2/`,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to fetch Management API token: ${res.status} ${body}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    mgmtTokenCache = { token: data.access_token, expiresAt: now + data.expires_in };
    return data.access_token;
}

/**
 * Looks up a user's full profile (name, picture, email) from the Auth0
 * Management API using their subject identifier (sub).
 */
export async function getUserProfile(
    sub: string,
    domain: string,
    clientId: string,
    clientSecret: string,
): Promise<UserProfile | null> {
    if (!clientId || !clientSecret) return null;
    try {
        const mgmtToken = await getManagementToken(domain, clientId, clientSecret);
        const encodedSub = encodeURIComponent(sub);
        const res = await fetch(`https://${domain}/api/v2/users/${encodedSub}`, {
            headers: { Authorization: `Bearer ${mgmtToken}` },
        });
        if (!res.ok) return null;
        return await res.json() as UserProfile;
    } catch {
        return null;
    }
}
