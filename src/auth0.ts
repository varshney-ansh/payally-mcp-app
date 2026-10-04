import { ApiClient, VerifyAccessTokenError } from "@auth0/auth0-api-js";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { requireBearerAuth, getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from "@modelcontextprotocol/express";
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/client";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { Auth, Auth0McpOptions } from "./types.js";

declare module "express-serve-static-core" {
  interface Request {
    auth0Mcp: ReturnType<typeof createAuth0Mcp>;
    mcpTransport?: NodeStreamableHTTPServerTransport;
    mcpServer?: McpServer;
  }
}

export function auth0Mcp(options: Auth0McpOptions) {
  //@ts-expect-error TypeScript doesnt like this
  const router = new express.Router();

  router.use(async (req: Request, res: Response, next: NextFunction) => {
    req.auth0Mcp = createAuth0Mcp({
      resourceName: options.resourceName,
      resourceServerUrl: options.resourceServerUrl,
      domain: options.domain,
      audience: options.audience,
    });
    next();
  });

  // Add metadata routes
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    const metadataRouter = await req.auth0Mcp.authMetadataRouter();
    return metadataRouter(req, res, next);
  });

  return router;
}

export function createAuth0Mcp(opts: Auth0McpOptions) {
  const verify = createVerifier(opts);

  const authMetadataRouter = createAuthMetadataRouter(opts);
  const authMiddleware = createAuthMiddleware(opts, verify);

  return {
    /**
     * Human-readable name for the protected resource (MCP server).
     */
    resourceName: opts.resourceName,

    /**
     * Creates an Express router that exposes OAuth metadata endpoints needed for MCP clients.
     */
    authMetadataRouter: () => authMetadataRouter,

    /**
     * Creates Express middleware for protecting MCP endpoints.
     * Validates Bearer tokens and populates req.auth with user information.
     */
    authMiddleware: () => authMiddleware,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Creates a JWT token verifier for Auth0-issued access tokens.
 *
 * This function returns a reusable `verify` function that validates JWT signatures,
 * token claims, and extracts user identity information for MCP integration using
 * the official @auth0/auth0-api-js library.
 */
function createVerifier(opts: Auth0McpOptions) {
  const apiClient = new ApiClient({
    domain: opts.domain,
    audience: opts.audience,
  });
  return async function verify(token: string): Promise<Auth> {
    try {
      const decoded = await apiClient.verifyAccessToken({
        accessToken: token,
      });

      if (!isNonEmptyString(decoded.sub)) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Token is missing required subject (sub) claim"
        );
      }

      let clientId: string | null = null;
      if (isNonEmptyString(decoded.client_id)) {
        clientId = decoded.client_id;
      } else if (isNonEmptyString(decoded.azp)) {
        clientId = decoded.azp;
      }

      if (!clientId) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Token is missing required client identification (client_id or azp claim)."
        );
      }

      return {
        token,
        clientId,
        scopes:
          typeof decoded.scope === "string"
            ? decoded.scope.split(" ").filter(Boolean)
            : [],
        ...(decoded.exp && { expiresAt: decoded.exp }),
        extra: {
          sub: decoded.sub,
          ...(isNonEmptyString(decoded.client_id) && {
            client_id: decoded.client_id,
          }),
          ...(isNonEmptyString(decoded.azp) && { azp: decoded.azp }),
          ...(isNonEmptyString(decoded.name) && { name: decoded.name }),
          ...(isNonEmptyString(decoded.email) && { email: decoded.email }),
        },
      };
    } catch (error) {
      if (error instanceof VerifyAccessTokenError) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, error.message);
      }
      throw error;
    }
  };
}

/**
 * Returns a router that includes MCP authorization metadata endpoints.
 */
async function createAuthMetadataRouter(opts: Auth0McpOptions) {
  const oauthMetadata = await discoverAuthorizationServerMetadata(
    new URL(`https://${opts.domain}`)
  );

  if (!oauthMetadata) {
    throw new Error(`Failed to fetch OAuth metadata from ${opts.domain}`);
  }

  return mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: opts.resourceServerUrl,
    resourceName: opts.resourceName,
    scopesSupported: ["openid", "profile", "email"],
  });
}

/**
 * Returns an Express middleware that protects MCP endpoints.
 */
function createAuthMiddleware(
  opts: Auth0McpOptions,
  verifier: (token: string) => Promise<Auth>
) {
  /* @mcp-codemod-error requireBearerAuth: resource-server auth helpers routed to the frozen @modelcontextprotocol/server-legacy/auth copy. The maintained v2 home is @modelcontextprotocol/express — when re-pointing, verifiers must throw the v2 OAuthError (the express middleware does not recognize the legacy error classes). See the migration guide's server auth split section. */
  return requireBearerAuth({
    /* @mcp-codemod-error getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter: resource-server auth helpers routed to the frozen @modelcontextprotocol/server-legacy/auth copy. The maintained v2 home is @modelcontextprotocol/express — when re-pointing, verifiers must throw the v2 OAuthError (the express middleware does not recognize the legacy error classes). See the migration guide's server auth split section. */
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      opts.resourceServerUrl
    ),
    verifier: { verifyAccessToken: verifier },
  });
}
