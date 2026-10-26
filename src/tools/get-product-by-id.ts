import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { getProductById } from '../payally-api.js';
import { ProductSchema } from '../payally-types/schema.js';
import { readWidgetHtml } from './widget-html.js';
import { toDataUri } from '../image-base64.js';
import type { Product, ProductImage } from '../payally-types/product.js';

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

      // WIDGET-facing view (structuredContent). This is a SINGLE-product gallery
      // with a bounded number of images, so (unlike the carousel) we encode ALL
      // images — main image, every images[] entry, and every variant image — to
      // base64 data URIs. Each encode has its own try/catch that falls back to
      // the ORIGINAL url so one broken image never breaks the card; all encodes
      // run in parallel.
      const encode = async (url: string): Promise<string> => {
        try {
          return await toDataUri(url);
        } catch {
          return url; // fall back to the original url string
        }
      };
      const encodeImage = async (img: ProductImage): Promise<ProductImage> => ({
        ...img,
        url: await encode(img.url),
      });

      const [mainImage, images, variants] = await Promise.all([
        product.image ? encodeImage(product.image) : Promise.resolve(undefined),
        Promise.all((product.images ?? []).map(encodeImage)),
        Promise.all(
          (product.variants ?? []).map(async (v) =>
            v.image ? { ...v, image: await encodeImage(v.image) } : v,
          ),
        ),
      ]);

      const widgetProduct: Product = {
        ...product,
        ...(mainImage ? { image: mainImage } : {}),
        images,
        variants,
      };

      return {
        structuredContent: widgetProduct,
        content: [{ type: 'text' as const, text: JSON.stringify(modelProduct) }],
      };
    },
  );
}
