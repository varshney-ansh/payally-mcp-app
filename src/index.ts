import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { auth0Mcp } from './auth0.js';
import type { Auth } from './types.js';
import { getUserProfile } from './utils.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? `http://localhost:${PORT}`;
const MCP_SERVER_RESOURCE_NAME = 'PayAlly';
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN as string;
const AUDIENCE = (process.env.AUTH0_AUDIENCE ?? MCP_SERVER_URL) as string;
const MGMT_CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID as string;
const MGMT_CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET as string;
const PAYPAL_MERCHANT_ID = process.env.PAYPAL_MERCHANT_ID as string;

// Validate required environment variables
if (!AUTH0_DOMAIN) {
    throw new Error('AUTH0_DOMAIN environment variable is required');
}

const requireAuth = (request: Request, response: Response, next: NextFunction) => {
    const authMiddleware = request.auth0Mcp.authMiddleware();
    return authMiddleware(request, response, next);
};

const app = express();

app.use(
    cors({
        origin: '*',
        exposedHeaders: ['Mcp-Session-Id'],
        allowedHeaders: ['Content-Type', 'mcp-session-id'],
    })
);

app.use(express.json());

app.use(
    auth0Mcp({
        resourceName: MCP_SERVER_RESOURCE_NAME,
        resourceServerUrl: new URL(MCP_SERVER_URL),
        domain: AUTH0_DOMAIN,
        audience: AUDIENCE,
    })
);

app.post('/mcp', requireAuth, async (req: Request, res: Response) => {
    try {
        const mcpServer = new McpServer({ name: MCP_SERVER_RESOURCE_NAME, version: '1.0.0' });

        mcpServer.registerTool(
            'AuthInfo',
            { description: 'logs out the authInfo' },
            async (ctx) => {
                const authInfo = ctx.http?.authInfo as Auth | undefined;
                const profile = authInfo ? await getUserProfile(authInfo.extra.sub, AUTH0_DOMAIN, MGMT_CLIENT_ID, MGMT_CLIENT_SECRET) : null;
                const merchantId = authInfo?.extra.paypal_merchant_id ?? PAYPAL_MERCHANT_ID;

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({ authInfo, profile, merchantId }),
                        },
                    ],
                };
            }
        );

        const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        res.on('close', () => transport.close());

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        console.error('Error handling MCP request:', err);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
            });
        }
    }
});

app.listen(PORT, () => {
    console.log(`PayAlly MCP Server started: ${MCP_SERVER_URL}`);
});
