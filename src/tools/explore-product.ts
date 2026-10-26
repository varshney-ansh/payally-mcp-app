import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { exploreProducts } from '../payally-api.js';
import { ProductSchema } from '../payally-types/schema.js';
import { readWidgetHtml } from './widget-html.js';
import { toDataUri } from '../image-base64.js';
import type { Product } from '../payally-types/product.js';

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
                // Images now arrive PRE-ENCODED as base64 data URIs from the
                // server (see the tool handler below), so the widget never
                // fetches images itself — only the API host remains for any
                // widget-initiated calls (connect-src → connectDomains).
                connectDomains: ['https://api.payally.world'],
                // resourceDomains maps to img-src (per McpUiResourceCsp). There
                // is no dedicated `data:` field in McpUiResourceCsp, so add the
                // literal 'data:' here to let <img> render inline base64 URIs,
                // and keep 'https://*' for the original-url fallback when a
                // server-side encode fails.
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

      // WIDGET-facing view (structuredContent). Encode ONLY the primary image
      // per card to base64 — encoding every image across a whole carousel would
      // bloat the notification payload and slow the tool. The single-product
      // gallery (getproductbyid) encodes all images instead. Per-product
      // try/catch falls back to the ORIGINAL url so one broken image can't break
      // the response; encodes run in parallel via Promise.all.
      const widgetProducts: Product[] = await Promise.all(
        products.map(async (p) => {
          const primaryUrl = p.image?.url ?? p.images?.[0]?.url;
          if (!primaryUrl) return p;
          let encoded = primaryUrl;
          try {
            encoded = await toDataUri(primaryUrl);
          } catch {
            // fall back to the original url string
          }
          // Rewrite the primary image url to the encoded (or fallback) value.
          if (p.image?.url) {
            return { ...p, image: { ...p.image, url: encoded } };
          }
          const [first, ...rest] = p.images ?? [];
          return { ...p, images: first ? [{ ...first, url: encoded }, ...rest] : p.images };
        }),
      );

      return {
        structuredContent: { query, products: widgetProducts, ...(nextPageToken ? { nextPageToken } : {}) },
        content: [{ type: 'text' as const, text: JSON.stringify(modelView) }],
      };
    },
  );
}
