# payally-mcp-app — Per-Brand MCP Server

> The agentic-commerce MCP server deployed once per merchant. Each instance is fully branded via environment variables — the same Docker image serves any brand, only the env changes. Customers browse products, manage a cart, and complete PayPal checkout entirely inside an AI assistant (Claude, ChatGPT, Gemini) without ever seeing "PayAlly."

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Part of [payally](https://github.com/varshney-ansh/payally)** — see the umbrella repo for the full architecture.

---

## What This Server Does

Every merchant gets their own dedicated MCP endpoint at `https://<brand>.mcp.payally.world`. The server exposes the brand's storefront as MCP tools that any MCP-compatible AI assistant can discover and call:

| Tool | Description |
|---|---|
| `explore-product` | Semantic search over the brand's catalog. Accepts a natural-language query, optional min/max price filters. Results come from the PayAlly Storefront API. |
| `getproductbyid` | Fetches full product details, variants, and images for a specific product ID. |
| `cart-add-items` | Adds products to the user's cart. Prices and item details are built server-side from cached catalog data — the AI model can choose *what* to add, never alter pricing. |
| `cart-update-items` | Updates quantity of one or more existing cart line items. |
| `cart-remove-items` | Removes one or more line items from the cart. |
| `cart-discard` | Discards (deletes) the entire active cart. |
| `checkout` | Converts the cart to a PayPal order and completes payment. Called only after explicit user confirmation. Cart is auto-discarded on success. |
| `list-my-orders` | Returns the buyer's order history with this merchant. |
| `get-order-details` | Fetches full details for a specific order. |
| `whoami` | Returns the currently authenticated user's identity (email, name, picture) — resolved from Auth0, never from the access token. |

**Security rule:** `PAYPAL_MERCHANT_ID` and all PayAlly internals are server-side only. The AI agent and customer see only the brand.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, TypeScript, `tsx` |
| HTTP server | Express 5 |
| MCP protocol | `@modelcontextprotocol/server`, `@modelcontextprotocol/node` |
| MCP auth | `@modelcontextprotocol/express`, `@auth0/auth0-api-js` |
| Cart state | Valkey (AWS ElastiCache) via `@valkey/valkey-glide` |
| Payments | PayPal Orders API v2 (via PayAlly Storefront API) |
| Inline UI widgets | React 19, StyleX, Astryx Design (bundled into MCP tool responses) |
| Validation | Zod |
| Image CDN | Uploadcare |

---

## Project Structure

```
mcp-app/
├── src/
│   ├── index.ts              # Express app entry — mounts auth middleware, /mcp route, /health
│   ├── auth0.ts              # Auth0 OAuth 2.0 resource server middleware + metadata router
│   ├── brand.ts              # Brand identity from env vars (name, store noun, voice, product nouns)
│   ├── types.ts              # Shared TypeScript types (Auth, Auth0McpOptions)
│   ├── payally-api.ts        # Thin HTTP client for the PayAlly Storefront API
│   ├── cart-store.ts         # Valkey-backed cart persistence (CartStore)
│   ├── product-store.ts      # In-process product cache (ProductStore) keyed merchantId:productId
│   ├── uploadcare.ts         # Image ingest helper for Uploadcare CDN
│   ├── utils.ts              # Shared utilities
│   ├── payally-types/        # Zod schemas mirroring PayPal Orders v2 item definition
│   │   ├── cart.ts           # Cart line item schema (CartLineItem, CartAddItemSchema)
│   │   ├── product.ts        # Product + variant schemas
│   │   ├── api.ts            # API response shapes (ExploreProductsResponse, etc.)
│   │   └── schema.ts         # Shared schema primitives
│   └── tools/                # MCP tool registrations (one file per tool group)
│       ├── explore-product.ts
│       ├── get-product-by-id.ts
│       ├── cart.ts           # cart-add-items, cart-update-items, cart-remove-items, cart-discard, checkout
│       ├── orders.ts         # list-my-orders, get-order-details
│       ├── auth.ts           # whoami + Auth0 Management API email resolver
│       └── widget-html.ts    # Inline HTML/React widget renderer for MCP tool results
├── web/
│   ├── src/                  # React components compiled into MCP tool result widgets
│   └── build.mjs             # esbuild bundler for inline UI widgets
├── infra/
│   └── brand-mcp-template.json  # CloudFormation template for per-brand ECS Fargate deployment
├── Dockerfile                # Production Docker image (Node 20 slim)
├── tsconfig.json
├── package.json
└── .env.example              # Environment variable template
```

---

## Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **Auth0** tenant with:
  - A Resource Server (API) registered per brand
  - An M2M application for Management API access (`AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET`)
  - AI Agents add-on enabled
- **PayAlly API key** (`PAYALLY-X-APIKEY`) — provisioned by the PayAlly Partner Portal at brand deploy time
- **PayPal Merchant ID** (`PAYPAL_MERCHANT_ID`) — the brand's PayPal account ID

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in all values in `.env`:

```env
# Auth0 Resource Server
AUTH0_DOMAIN=accounts.payally.world
AUTH0_AUDIENCE=https://<brand>.mcp.payally.world/

# Auth0 Management API (M2M app with read:users permission)
AUTH0_MGMT_CLIENT_ID=your_mgmt_client_id
AUTH0_MGMT_CLIENT_SECRET=your_mgmt_client_secret
AUTH0_MGMT_AUDIENCE=https://<your-auth0-tenant>.auth0.com/api/v2/

# Server
PORT=3001
MCP_SERVER_URL=http://localhost:3001

# Brand identity — presented to the AI agent, never reveals PayAlly
BRAND_NAME=Nike
BRAND_STORE_NOUN=store
BRAND_VOICE=Athletic, performance-driven, premium.
BRAND_PRODUCT_NOUNS=sneakers, running shoes, training gear
BRAND_CATEGORY_HINTS=Athletic Shoes, Running, Training

# PayAlly Storefront API key (AWS API Gateway)
PAYALLY-X-APIKEY=your_api_key

# Brand's PayPal merchant ID — server-side only, never exposed to agent or customer
PAYPAL_MERCHANT_ID=your_paypal_merchant_id
```

### 3. Build inline UI widgets

```bash
npm run build:ui
```

### 4. Start the development server

```bash
npm start
```

The server starts on `http://localhost:3001`.

- **MCP endpoint:** `POST http://localhost:3001/mcp`
- **Health check:** `GET http://localhost:3001/health`
- **OAuth metadata:** `GET http://localhost:3001/.well-known/oauth-protected-resource`

### 5. Production build

```bash
npm run build      # compiles TypeScript + bundles widgets
npm run serve      # runs compiled output from build/
```

---

## Connecting to an AI Assistant

### Claude (Desktop)

Add to your Claude MCP configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "brand-store": {
      "url": "http://localhost:3001/mcp",
      "transport": "http"
    }
  }
}
```

### ChatGPT / Gemini

Point the MCP connector at `http://localhost:3001/mcp` (or the deployed `https://<brand>.mcp.payally.world/mcp`).

---

## Docker

```bash
# Build
docker build -t payally-mcp-app .

# Run (pass env vars)
docker run -p 3001:3001 \
  -e AUTH0_DOMAIN=accounts.payally.world \
  -e AUTH0_AUDIENCE=https://my-brand.mcp.payally.world/ \
  -e BRAND_NAME="My Brand" \
  -e PAYPAL_MERCHANT_ID=your_merchant_id \
  -e PAYALLY-X-APIKEY=your_api_key \
  payally-mcp-app
```

---

## Infrastructure (ECS Fargate)

Per-brand production deployments are provisioned automatically by the [PayAlly Partner Portal](https://github.com/varshney-ansh/payally-partner) via the CloudFormation template at `infra/brand-mcp-template.json`. Each brand gets:

- ECS Fargate task on `eu-west-1`
- ALB listener rule routing `<brand>.mcp.payally.world` to the task
- ElastiCache (Valkey) cluster for cart state
- ACM TLS certificate + Route 53 DNS record
- IAM task role with scoped ElastiCache connect permissions

---

## Testing Instructions for Judges

Use the demo merchant credentials from the [umbrella repo README](https://github.com/varshney-ansh/payally) to log in to the Partner Portal and retrieve the deployed MCP endpoint URL for the demo brand. Connect that URL to Claude, ChatGPT, or Gemini and interact with the store.

PayPal sandbox accounts for checkout testing: create a free sandbox buyer account at [developer.paypal.com](https://developer.paypal.com/dashboard/accounts).

---

## License

MIT — see [LICENSE](../LICENSE)
