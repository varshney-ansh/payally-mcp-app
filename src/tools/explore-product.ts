import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { exploreProducts } from '../payally-api.js';
import { ProductSchema } from '../payally-types/schema.js';
import { readWidgetHtml } from './widget-html.js';

const WIDGET_URI = 'ui://widget/explore-product.html';

/**
 * Registers the `explore-product` tool and its inline carousel widget.
 *
 * `query`, `min_price` and `max_price` are the caller-supplied arguments. The
 * merchant id is env-only (the `merchantIdFallback` arg) and is never exposed
 * as an argument nor read from auth info.
 */
export function registerExploreProduct(server: McpServer, merchantIdFallback: string) {
  registerAppResource(
    server,
    'explore-product-widget',
    WIDGET_URI,
    { description: 'A horizontally scrollable carousel of PayAlly products matching the search query.' },
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
                // structuredContent carries the ORIGINAL product image urls
                // unchanged; the widget renders them directly (no base64, no
                // widget-side image fetch). Only the API host remains for any
                // widget-initiated calls (connect-src → connectDomains).
                connectDomains: ['https://api.payally.world'],
                // resourceDomains maps to img-src (per McpUiResourceCsp).
                // Product images come from arbitrary brand domains, so we
                // allowlist 'https://*' for them, plus 'data:' for the inline
                // SVG placeholder the widget swaps in when an image is blocked
                // or fails to load.
                resourceDomains: ['https://*', 'data:'],
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
      title: 'Explore products',
      description:
        'Search the PayAlly catalog and show matching products in an interactive, horizontally scrollable carousel.',
      inputSchema: z.object({
        query: z.string().min(1).describe('What the customer is shopping for.'),
        min_price: z.number().optional().describe('Minimum product price filter.'),
        max_price: z.number().optional().describe('Maximum product price filter.'),
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

      // WIDGET-facing view (structuredContent). Carries the products with
      // their ORIGINAL image urls, unchanged — no base64, no server-side image
      // fetch. The widget renders the urls directly (allowlisted via the
      // resource CSP) and swaps an inline SVG placeholder on load failure.
      return {
        structuredContent: { query, products, ...(nextPageToken ? { nextPageToken } : {}) },
        content: [{ type: 'text' as const, text: JSON.stringify(modelView) }],
      };
    },
  );
}
