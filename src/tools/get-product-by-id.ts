import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { getProductById } from '../payally-api.js';
import { ProductSchema } from '../payally-types/schema.js';
import { readWidgetHtml } from './widget-html.js';

const WIDGET_URI = 'ui://widget/get-product-by-id.html';

/**
 * Registers the `getproductbyid` tool and its inline card widget.
 *
 * `productId` is the only caller-supplied argument. The merchant id is env-only
 * (the `merchantIdFallback` arg) and is never exposed as an argument nor read
 * from auth info.
 */
export function registerGetProductById(server: McpServer, merchantIdFallback: string) {
  registerAppResource(
    server,
    'get-product-by-id-widget',
    WIDGET_URI,
    { description: 'A single PayAlly product card with image, price and details.' },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readWidgetHtml('get-product-by-id.js'),
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
    'getproductbyid',
    {
      title: 'Get product by id',
      description: 'Look up a single PayAlly product by its id and show it as a compact inline card.',
      inputSchema: z.object({
        productId: z.string().min(1).describe('The PayAlly product id to look up.'),
      }),
      outputSchema: ProductSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          // McpUiToolMeta.visibility defaults to ["model", "app"], so this tool
          // is ALREADY app-callable (the carousel calls it via callServerTool).
          // We set it explicitly as a defensive, self-documenting restatement so
          // the getproductbyid click path keeps working even if a host narrows
          // the default. Values are the only allowed scopes: "model" | "app".
          visibility: ['model', 'app'],
        },
        'openai/toolInvocation/invoking': 'Fetching product…',
        'openai/toolInvocation/invoked': 'Product ready',
      },
    },
    async ({ productId }) => {
      const merchantId = merchantIdFallback;
      const product = await getProductById(productId, merchantId);

      // MODEL-facing view (`content` text channel — surfaced to the model).
      // Full product JSON with ORIGINAL http(s) image urls; NEVER base64 blobs.
      // This is BUG 1: previously only a "Product: title (id)." summary was sent,
      // so the model could not read the product's details.
      const modelProduct = product;

      // WIDGET-facing view (structuredContent). Carries the product with its
      // ORIGINAL image urls, unchanged — no base64, no server-side image fetch.
      // The widget renders the urls directly (allowlisted via the resource CSP)
      // and swaps an inline SVG placeholder on load failure.
      return {
        structuredContent: product,
        content: [{ type: 'text' as const, text: JSON.stringify(modelProduct) }],
      };
    },
  );
}
