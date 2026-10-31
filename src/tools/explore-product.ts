import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { exploreProducts } from '../payally-api.js';
import { ProductSchema } from '../payally-types/schema.js';
import { toUploadcareImage, uploadcareCdnOrigin } from '../uploadcare.js';
import { readWidgetHtml } from './widget-html.js';
import { brand, sellsNoun } from '../brand.js';

const WIDGET_URI = 'ui://widget/explore-product.html';

/**
 * Registers the `explore-product` tool and its inline carousel widget.
 *
 * `query`, `min_price` and `max_price` are the caller-supplied arguments. The
 * merchant id is env-only (the `merchantIdFallback` arg) and is never exposed
 * as an argument nor read from auth info.
 */
export function registerExploreProduct(
  server: McpServer,
  merchantIdFallback: string,
  productStore?: import('../product-store.js').ProductStore,
) {
  registerAppResource(
    server,
    'explore-product-widget',
    WIDGET_URI,
    { description: `A horizontally scrollable carousel of ${brand.name} products matching the search query.` },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readWidgetHtml('explore-product.js'),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                // structuredContent delivers every product image from
                // Uploadcare's single CDN origin: each brand-domain image is
                // ingested server-side (upload-from-URL → UUID) and served from
                // the one allowlistable CDN host — no base64, no widget-side
                // image fetch. connect-src keeps the API host for any
                // widget-initiated calls.
                connectDomains: ['https://api.payally.world'],
                // resourceDomains maps to img-src (per McpUiResourceCsp).
                // Product images come from arbitrary brand domains, so a host
                // allowlist of those domains is impossible; instead every image
                // is delivered from Uploadcare's single CDN origin. We allowlist
                // that one concrete origin plus 'data:' for the inline-SVG
                // placeholder the widget swaps in on load failure.
                resourceDomains: [uploadcareCdnOrigin, 'data:'],
              },
            },
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    'explore-product',
    {
      title: `Search ${brand.name} products`,
      description:
        `Search the ${brand.name} catalog for ${sellsNoun(brand)}. Use when the user wants to browse or find products by keyword. Returns matching products (id, title, price, image) as an inline carousel — use the product id with other tools (get details, add to cart).`,
      inputSchema: z.object({
        query: z.string().min(1).describe('Free-text search: what the user is shopping for, e.g. "running shoes" or "white sneakers".'),
        min_price: z.number().optional().describe('Optional minimum price (number). Omit for no lower bound.'),
        max_price: z.number().optional().describe('Optional maximum price (number). Omit for no upper bound.'),
      }),
      outputSchema: z.object({
        query: z.string(),
        products: z.array(ProductSchema),
        nextPageToken: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        'openai/toolInvocation/invoking': 'Searching products…',
        'openai/toolInvocation/invoked': 'Products ready',
      },
    },
    async ({ query, min_price, max_price }) => {
      const merchantId = merchantIdFallback;
      const { products, nextPageToken } = await exploreProducts(query, merchantId, {
        minPrice: min_price,
        maxPrice: max_price,
      });

      // Cache authoritative prices keyed merchantId:productId so the cart tools
      // can build trusted line items instead of trusting model-supplied data.
      // Best-effort (fire-and-forget); never blocks or breaks the search.
      void productStore?.cacheProducts(products, merchantId);

      // MODEL-facing view (goes into the `content` text channel, which Claude
      // surfaces to the model). Compact: id/title/price/seller/category with
      // ORIGINAL http(s) image urls — NEVER base64 blobs (keeps the payload
      // small and readable). This is what BUG 1 was missing: the full product
      // data was only in structuredContent, which the model never sees.
      const modelView = products.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        seller: p.seller,
        category: p.category,
        image: p.image?.url ?? p.images?.[0]?.url,
      }));

      // WIDGET-facing view (structuredContent). Carries the products with the
      // PRIMARY image (the one the card renders) delivered from Uploadcare's
      // single CDN origin — no base64. Only the primary image is ingested per
      // product (bounded work for a many-product carousel); the widget renders
      // that url directly (allowlisted via the resource CSP single origin) and
      // swaps an inline SVG placeholder on load failure. Ingests run in
      // parallel and share a server-side cache (one ingest per unique url).
      const widgetProducts = await Promise.all(
        products.map(async (p) => {
          const primary = p.image?.url ?? p.images?.[0]?.url;
          if (!primary) return p;
          const cdn = await toUploadcareImage(primary);
          return {
            ...p,
            ...(p.image ? { image: { ...p.image, url: p.image.url === primary ? cdn : p.image.url } } : {}),
            images: (p.images ?? []).map((img, i) =>
              i === 0 && !p.image ? { ...img, url: cdn } : img,
            ),
          };
        }),
      );

      return {
        structuredContent: { query, products: widgetProducts, ...(nextPageToken ? { nextPageToken } : {}) },
        content: [{ type: 'text' as const, text: JSON.stringify(modelView) }],
      };
    },
  );
}
