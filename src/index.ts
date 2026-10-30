import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { auth0Mcp } from './auth0.js';
import { registerExploreProduct } from './tools/explore-product.js';
import { registerGetProductById } from './tools/get-product-by-id.js';
import { registerCartTools } from './tools/cart.js';
import { CartStore } from './cart-store.js';
import { ProductStore } from './product-store.js';

import { ClosingError, GlideClusterClient, Logger, ServiceType } from "@valkey/valkey-glide";

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? `http://localhost:${PORT}`;
const MCP_SERVER_RESOURCE_NAME = 'PayAlly';
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN as string;
const AUDIENCE = (process.env.AUTH0_AUDIENCE ?? MCP_SERVER_URL) as string;
const MGMT_CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID as string;
const MGMT_CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET as string;
const PAYPAL_MERCHANT_ID = process.env.PAYPAL_MERCHANT_ID as string;
const ELASTIC_URL = process.env.ELASTIC_URL as string;

let client: GlideClusterClient | null = null;
let cartStore: CartStore | null = null;
let productStore: ProductStore | null = null;

// Validate required environment variables
if (!AUTH0_DOMAIN) {
    throw new Error('AUTH0_DOMAIN environment variable is required');
}

const requireAuth = (request: Request, response: Response, next: NextFunction) => {
    const authMiddleware = request.auth0Mcp.authMiddleware();
    return authMiddleware(request, response, next);
};

try {
    Logger.setLoggerConfig("info");
    console.log("Connecting to Valkey Glide...");
    // Create a standalone client
    client = await GlideClusterClient.createClient({
        addresses: [{ host: ELASTIC_URL, port: 6379 }], useTLS: true,
        credentials: {
            username: "ecs-cache-user",
            iamConfig: {
                clusterName: "payally-cachedb",
                service: ServiceType.Elasticache,
                region: "eu-west-1",
            }
        }
    });

    console.log("Connected successfully.");
    cartStore = new CartStore(client);
    productStore = new ProductStore(client);

} catch (error) {
    console.error("An exception occurred:", error);
}

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

app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: MCP_SERVER_RESOURCE_NAME,
        version: '1.0.0',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
    });
});

app.get('/cache-server-status', async(_req: Request, res: Response) => {
    if (!client) return res.status(500).json({
        error_msg: 'client not configured'
    })
    const pong = await client.ping();
    res.status(200).json({
        status: pong,
    });
})

app.post('/mcp', requireAuth, async (req: Request, res: Response) => {
    try {
        const mcpServer = new McpServer({ name: MCP_SERVER_RESOURCE_NAME, version: '1.0.0' });

        registerExploreProduct(mcpServer, PAYPAL_MERCHANT_ID, productStore ?? undefined);
        registerGetProductById(mcpServer, PAYPAL_MERCHANT_ID, productStore ?? undefined);

        // Cart tools require the Valkey cache (cart + product-details stores);
        // only register when connected.
        if (cartStore && productStore) {
            registerCartTools(mcpServer, cartStore, productStore, PAYPAL_MERCHANT_ID, {
                domain: AUTH0_DOMAIN,
                mgmtClientId: MGMT_CLIENT_ID,
                mgmtClientSecret: MGMT_CLIENT_SECRET,
            });
        } else {
            console.warn('Valkey client unavailable — cart tools not registered.');
        }

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
