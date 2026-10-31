import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { getProductById } from '../payally-api.js';
import { ProductSchema } from '../payally-types/schema.js';
import { toUploadcareImage, uploadcareCdnOrigin } from '../uploadcare.js';
import { readWidgetHtml } from './widget-html.js';
import { brand } from '../brand.js';

const WIDGET_URI = 'ui://widget/get-product-by-id.html';

/**
 * Registers the `getproductbyid` tool and its inline card widget.
 *
 * `productId` is the only caller-supplied argument. The merchant id is env-only
 * (the `merchantIdFallback` arg) and is never exposed as an argument nor read
 * from auth info.
 */
export function registerGetProductById(
  server: McpServer,
  merchantIdFallback: string,
  productStore?: import('../product-store.js').ProductStore,
) {
  registerAppResource(
    server,
    'get-product-by-id-widget',
    WIDGET_URI,
    { description: `A single ${brand.name} product card with image, price and details.` },
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
    'getproductbyid',
    {
      title: `Get ${brand.name} product details`,
      description: `Get full details for one ${brand.name} product (description, all images, variants, rating) as an inline card. Use when the user picks a product or asks to "see"/"tell me about" a specific one. Use a product id from a search — do not invent ids.`,
      inputSchema: z.object({
        productId: z.string().min(1).describe(`The ${brand.name} product id (from a search result) to look up.`),
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

      // Cache authoritative details keyed merchantId:productId so the cart tools
      // can build trusted line items from a productId alone (no model-supplied
      // price/name). Best-effort (fire-and-forget).
      void productStore?.cacheProduct(product, merchantId);

      // MODEL-facing view (`content` text channel — surfaced to the model).
      // Full product JSON with ORIGINAL http(s) image urls; NEVER base64 blobs.
      // This is BUG 1: previously only a "Product: title (id)." summary was sent,
      // so the model could not read the product's details.
      const modelProduct = product;

      // WIDGET-facing view (structuredContent). Carries the product with EVERY
      // image (main + gallery images[] + variant images) delivered from
      // Uploadcare's single CDN origin — no base64. The single-product gallery
      // shows all images, so all are ingested (in parallel, sharing a
      // server-side cache). The widget renders those urls directly (allowlisted
      // via the resource CSP single origin) and swaps an inline SVG placeholder
      // on load failure.
      const [mainImage, images, variants] = await Promise.all([
        product.image
          ? toUploadcareImage(product.image.url).then((url) => ({ ...product.image!, url }))
          : Promise.resolve(undefined),
        Promise.all(
          (product.images ?? []).map(async (img) => ({ ...img, url: await toUploadcareImage(img.url) })),
        ),
        Promise.all(
          (product.variants ?? []).map(async (v) =>
            v.image ? { ...v, image: { ...v.image, url: await toUploadcareImage(v.image.url) } } : v,
          ),
        ),
      ]);

      const widgetProduct = {
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
