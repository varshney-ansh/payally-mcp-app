# PayAlly Branded MCP — Brand Template

This MCP server is a **template** deployed **once per merchant**, each instance branded for that merchant. The same build serves every brand — only environment variables change. The PayAlly Partner portal collects these at onboarding and injects them at deploy.

**Golden rule:** the customer and their AI agent must only ever see the *brand* — never PayAlly, and never the PayPal merchant id.

## What the Partner portal collects (per brand)

| Env var | Required | Example | What it does |
|---|---|---|---|
| `BRAND_NAME` | ✅ | `Nike` | The brand's display name. Becomes the MCP server name and appears in every tool description, so the agent talks about "the Nike store", never PayAlly. |
| `BRAND_STORE_NOUN` | ✅ | `store` | What the brand calls its storefront (`store`, `boutique`, `shop`). Produces "the Nike store catalog". Default `store`. |
| `BRAND_PRODUCT_NOUNS` | ➖ | `sneakers, running shoes, training gear, athletic apparel` | Natural nouns for what the brand sells. Shapes tool descriptions so the agent speaks the brand's language (comma/semicolon separated). |
| `BRAND_CATEGORY_HINTS` | ➖ | `Athletic Shoes, Running, Training, Sneakers` | High-level category hints for phrasing **only**. The real categories come from the live catalog API — keep this short so it can't drift. |
| `BRAND_VOICE` | ➖ | `Athletic, performance-driven, premium.` | One-line tone hint woven into descriptions. |

## Also required per instance (operational, not brand-copy)

| Env var | Purpose |
|---|---|
| `PAYPAL_MERCHANT_ID` | The **brand's** PayPal merchant id. Server-side only — **never** returned by any tool. |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`, `AUTH0_MGMT_AUDIENCE` | Per-brand Auth0 (login + profile/email resolution). |
| `ELASTIC_URL` | Valkey cache host (carts + product-details cache). |
| `MCP_SERVER_URL`, `PORT` | Public base URL of this instance + listen port. |
| `UPLOADCARE_PUBLIC_KEY` | Server-side image ingest origin for product images. |
| `PAYALLY_API_BASE` | Optional override for the PayAlly storefront API base. |

## How the template uses these

- **`src/brand.ts`** builds a `Brand` object from the env at startup (`brand`) plus phrase helpers: `storePhrase` ("the Nike store"), `sellsNoun` ("sneakers, running shoes and training gear across Athletic Shoes and Running").
- **Every tool title + description** reads from `brand`, so the agent-facing text is always in the brand's voice and names the brand. Tool *names* stay brand-neutral and stable (`explore-product`, `getproductbyid`, `cart-*`, `checkout`, `list-my-orders`, `get-order-details`, `whoami`) — only the human/agent-facing copy is branded.
- **The MCP server `name`** (from `brand.name`) is what shows in the host's tool list.
- **Tool names are stable** across brands; only titles/descriptions/widgets change per brand. Widgets are Astryx-themed (brand theming is a separate follow-up).

## To onboard a new brand

1. Collect the table above in the Partner portal.
2. Deploy this container with that env (one instance per brand).
3. The agent connecting to it sees a brand-native storefront — no PayAlly mention anywhere.

## Example — Nike

```
BRAND_NAME=Nike
BRAND_STORE_NOUN=store
BRAND_VOICE=Athletic, performance-driven, premium.
BRAND_PRODUCT_NOUNS=sneakers, running shoes, training gear, athletic apparel
BRAND_CATEGORY_HINTS=Athletic Shoes, Running, Training, Sneakers
```

Resulting tool copy (agent-facing):
- *Search Nike products* — "Search the Nike catalog for sneakers, running shoes, training gear and athletic apparel across Athletic Shoes, Running, Training and Sneakers…"
- *Add to cart* — "Add Nike products to the shopping cart… price, name and every other detail are resolved server-side from the Nike catalog and CANNOT be changed by the caller."
- *Checkout* — "Pay for the current cart. Use ONLY when the user confirms they are ready to pay…"
