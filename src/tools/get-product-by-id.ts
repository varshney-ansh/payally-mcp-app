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
                connectDomains: ['https://api.payally.world'],
                // Product images come from arbitrary CDNs, so allow any https host.
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
        ui: { resourceUri: WIDGET_URI },
        'openai/toolInvocation/invoking': 'Fetching product…',
        'openai/toolInvocation/invoked': 'Product ready',
      },
    },
    async ({ productId }) => {
      const merchantId = merchantIdFallback;
      const product = await getProductById(productId, merchantId);

      return {
        structuredContent: product,
        content: [{ type: 'text' as const, text: `Product: ${product.title} (${product.id}).` }],
      };
    },
  );
}
