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
                // The widget fetches each product image client-side and encodes
                // it to a base64 data URI (connect-src). Images come from
                // arbitrary CDNs, so allow any https host. If a host rejects the
                // 'https://*' wildcard form, change it to '*'.
                connectDomains: ['https://api.payally.world', 'https://*'],
                // Direct-URL <img> fallback (img-src) when base64 encoding fails.
                resourceDomains: ['https://*'],
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

      const summary = products.length
        ? `Found ${products.length} product(s) for "${query}".`
        : `No products found for "${query}".`;

      return {
        structuredContent: { query, products, ...(nextPageToken ? { nextPageToken } : {}) },
        content: [{ type: 'text' as const, text: summary }],
      };
    },
  );
}
