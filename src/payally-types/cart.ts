import { z } from 'zod';

/**
 * Zod schemas for the PayAlly cart, mirroring the PayPal Orders v2 `item`
 * definition so a stored line item can be handed to order creation unchanged.
 *
 * Reference: https://developer.paypal.com/api/orders/v2/definitions/item
 *
 * NOTE: PayPal models monetary values and quantities as STRINGS (not numbers)
 * — `unit_amount.value`, `tax.value` and `quantity` are all strings with the
 * documented regex/length constraints. We keep that contract exactly so these
 * items round-trip into the Orders API without conversion.
 */

/** PayPal `money`: a currency code + a decimal string value. */
export const MoneySchema = z.object({
  /** 3-letter ISO-4217 currency code, e.g. "USD". */
  currency_code: z
    .string()
    .length(3)
    .describe('3-letter ISO-4217 currency code, e.g. "USD".'),
  /**
   * The value as a string. Integer for currencies like JPY, decimal fraction
   * for currencies subdivided into thousandths like TND.
   */
  value: z
    .string()
    .max(32)
    .regex(/^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$/, 'Must be a numeric string, e.g. "9.99".')
    .describe('The monetary amount as a string, e.g. "9.99".'),
});

/** PayPal `universal_product_code`. */
export const UpcSchema = z.object({
  /** The UPC type. */
  type: z
    .enum(['UPC-A', 'UPC-B', 'UPC-C', 'UPC-D', 'UPC-E', 'UPC-2', 'UPC-5'])
    .describe('The Universal Product Code type.'),
  /** The UPC code for the item. */
  code: z.string().min(6).max(17).describe('The UPC code for the item.'),
});

/**
 * PayPal `order_billing_plan` — metadata for merchant-managed recurring
 * billing. Rarely used for a simple cart; modelled loosely (passthrough) so it
 * round-trips if a caller supplies it, without over-constraining the shape.
 */
export const BillingPlanSchema = z
  .object({
    billing_cycles: z.array(z.record(z.string(), z.unknown())).optional(),
    product_price: MoneySchema.optional(),
    one_time_charges: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const ITEM_CATEGORIES = ['DIGITAL_GOODS', 'PHYSICAL_GOODS', 'DONATION'] as const;

/**
 * A single cart item, mirroring the PayPal Orders v2 `item` definition.
 * This is the shape callers provide when ADDING items.
 */
export const CartItemInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(3000)
    .describe(
      'The item name or title. Stored up to 3000 chars; PayPal truncates to 127 chars in its response representation.',
    ),
  unit_amount: MoneySchema.describe('The per-unit price (currency + amount) for the item.'),
  tax: MoneySchema.optional().describe('The per-unit tax (currency + amount) for the item.'),
  quantity: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/, 'Must be a whole number from 1 up to 10 digits.')
    .describe('The item quantity as a whole-number string, e.g. "2".'),
  description: z
    .string()
    .max(4000)
    .optional()
    .describe('Item description. Stored up to 4000 chars; PayPal truncates to 2048 in its response.'),
  sku: z.string().max(127).optional().describe('The stock keeping unit (SKU) for the item.'),
  url: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe('The URL to the item being purchased. Visible to the buyer.'),
  category: z
    .enum(ITEM_CATEGORIES)
    .optional()
    .describe('The item category type: DIGITAL_GOODS, PHYSICAL_GOODS or DONATION.'),
  image_url: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe("The URL of the item's image (JPEG, PNG or GIF)."),
  upc: UpcSchema.optional().describe('The Universal Product Code of the item.'),
  billing_plan: BillingPlanSchema.optional().describe(
    'Metadata for merchant-managed recurring billing plans.',
  ),
});

/**
 * A stored line item: the full PayPal item shape (SERVER-BUILT from trusted
 * cached/fetched product details — never from model input) plus a
 * server-assigned `lineId` and the `productId`/`variantId` it was built from.
 */
export const CartLineItemSchema = CartItemInputSchema.extend({
  lineId: z.string().describe('Server-assigned stable id for this line item.'),
  productId: z.string().describe('The PayAlly product id this line item was built from.'),
  variantId: z.string().optional().describe('The product variant id, when a variant was chosen.'),
});

/** The full cart document persisted in Valkey. */
export const CartSchema = z.object({
  cartId: z.string(),
  /** Buyer identity — the authenticated user's email (from the Auth0 profile). */
  userEmail: z.string(),
  merchantId: z.string(),
  items: z.array(CartLineItemSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * ADD input — the ONLY fields the model supplies. Price, name, sku, image etc.
 * are NEVER accepted from the caller; the server builds the line item from the
 * authoritative product details (cache, or API fallback). This prevents the
 * model from altering any line-item data, especially price.
 */
export const CartAddItemSchema = z.object({
  productId: z.string().min(1).describe('The PayAlly product id to add.'),
  variantId: z
    .string()
    .min(1)
    .optional()
    .describe('The product variant id, when the product has selectable variants.'),
  quantity: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/, 'Must be a whole number from 1 up to 10 digits.')
    .default('1')
    .describe('The quantity to add, as a whole-number string, e.g. "2". Defaults to "1".'),
});

/**
 * UPDATE input — the model may only change the QUANTITY of an existing line
 * item (by lineId). Price/name/attributes are server-owned and cannot be
 * altered by the model.
 */
export const CartItemUpdateSchema = z.object({
  lineId: z.string().min(1).describe('The lineId of the item to update.'),
  quantity: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/, 'Must be a whole number from 1 up to 10 digits.')
    .describe('The new quantity, as a whole-number string, e.g. "3".'),
});

export type Money = z.infer<typeof MoneySchema>;
export type CartItemInput = z.infer<typeof CartItemInputSchema>;
export type CartAddItem = z.infer<typeof CartAddItemSchema>;
export type CartLineItem = z.infer<typeof CartLineItemSchema>;
export type Cart = z.infer<typeof CartSchema>;
export type CartItemUpdate = z.infer<typeof CartItemUpdateSchema>;

export { ITEM_CATEGORIES };
