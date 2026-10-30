import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { CartStore, ResolvedLineItem } from '../cart-store.js';
import type { ProductStore } from '../product-store.js';
import type { Cart } from '../payally-types/cart.js';
import type { Auth } from '../types.js';
import { getUserProfile, extractEmail } from '../utils.js';
import { createCheckout, type CheckoutItem } from '../payally-api.js';
import { CartAddItemSchema, CartItemUpdateSchema, ITEM_CATEGORIES } from '../payally-types/cart.js';
import type { CartLineItem } from '../payally-types/cart.js';

/**
 * Cart tools — plain (non-UI) MCP tools that mutate a Valkey-backed cart and
 * return the cart details as model-visible JSON. No widgets / `ui://` resources.
 *
 *   cart-add-items     insert products / SKUs / variants into the active cart
 *   cart-update-items  change quantities / options / attributes of line items
 *   cart-remove-items  delete specific line items, or clear all items
 *   cart-discard       discard (delete) the whole cart
 *
 * The merchant id is env-only (passed in, never a tool argument). The buyer is
 * identified by email, resolved from the Auth0 PROFILE (Management API lookup
 * by `sub`) — NOT from the access token, which carries only `sub` and
 * `paypal_merchant_id` (no email/name/picture; verified against a live token).
 * `cartId` is OPTIONAL on every tool: when omitted, the user's active cart is
 * used (and created on first add).
 */

/** Auth0 config needed to resolve the buyer's profile (email) from `sub`. */
export interface CartAuthConfig {
  domain: string;
  mgmtClientId: string;
  mgmtClientSecret: string;
  /** Canonical tenant Management API audience (custom-domain audience → 403). */
  mgmtAudience?: string;
}

/**
 * Resolves the authenticated buyer's email.
 *
 * Auth is read from the FIRST handler argument (`ctx.http.authInfo`), the
 * `ServerContext` — the same place the reference `AuthInfo` tool read it. The
 * token has no email claim, so the email comes from the Auth0 Management API
 * profile looked up by `sub`.
 */
async function requireUserEmail(ctx: unknown, auth: CartAuthConfig): Promise<string> {
  const authInfo = (ctx as { http?: { authInfo?: Auth } } | undefined)?.http?.authInfo;
  const sub = authInfo?.extra?.sub;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('No authenticated user on the request. Sign in to use the cart.');
  }

  const profile = await getUserProfile(
    sub,
    auth.domain,
    auth.mgmtClientId,
    auth.mgmtClientSecret,
    auth.mgmtAudience,
  );
  const email = extractEmail(profile);
  if (!email) {
    // Last-resort fallback: key the cart on the stable `sub` when the profile
    // genuinely has no email (so the cart still works). The server log from
    // getUserProfile shows WHY the email was missing (403 scope / 404 / etc.).
    console.warn(`[cart] No email for sub=${sub}; falling back to sub as buyer key.`);
    return sub;
  }
  return email;
}

/** Compact, model-friendly view of a cart returned in the `content` channel. */
function cartView(cart: Cart) {
  const itemTotals = cart.items.reduce(
    (acc, i) => {
      const qty = Number(i.quantity);
      acc.units += qty;
      acc.amount += Number(i.unit_amount.value) * qty;
      if (!acc.currency) acc.currency = i.unit_amount.currency_code;
      return acc;
    },
    { units: 0, amount: 0, currency: '' as string },
  );

  return {
    cartId: cart.cartId,
    merchantId: cart.merchantId,
    itemCount: cart.items.length,
    totalUnits: itemTotals.units,
    estimatedItemTotal: cart.items.length
      ? { currency_code: itemTotals.currency, value: itemTotals.amount.toFixed(2) }
      : undefined,
    items: cart.items,
    updatedAt: cart.updatedAt,
  };
}

/**
 * Maps a STORED cart line item to the PayPal-shaped checkout item, stripping
 * the internal cart fields (lineId, productId, variantId) that are not part of
 * the PayPal item schema. Items come from the cached cart — built from trusted
 * catalog data — so nothing here is model-supplied.
 */
function toCheckoutItem(line: CartLineItem): CheckoutItem {
  const { lineId, productId, variantId, ...paypalItem } = line;
  void lineId;
  void productId;
  void variantId;
  return paypalItem as CheckoutItem;
}

function ok(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function fail(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}

/**
 * Registers the four cart tools on the MCP server.
 *
 * @param server            the per-request McpServer
 * @param store             the Valkey-backed CartStore
 * @param merchantIdFallback env PAYPAL_MERCHANT_ID (never exposed as an arg)
 * @param auth              Auth0 config for resolving the buyer email from `sub`
 */
export function registerCartTools(
  server: McpServer,
  store: CartStore,
  productStore: ProductStore,
  merchantIdFallback: string,
  auth: CartAuthConfig,
) {
  /**
   * Maps a cached/fetched product category string onto the PayPal item
   * category enum. Unknown values fall back to PHYSICAL_GOODS.
   */
  const toItemCategory = (c?: string): (typeof ITEM_CATEGORIES)[number] =>
    (ITEM_CATEGORIES as readonly string[]).includes(c ?? '')
      ? (c as (typeof ITEM_CATEGORIES)[number])
      : 'PHYSICAL_GOODS';
  const cartIdArg = z
    .string()
    .optional()
    .describe('The cart id to operate on. Omit to use (or create) the buyer\'s active cart.');

  // 1) ADD ITEMS ------------------------------------------------------------
  server.registerTool(
    'cart-add-items',
    {
      title: 'Add items to cart',
      description:
        'Add one or more products to the active cart by productId (and optional variantId) and quantity. Prices, names and all other line-item details are taken from the authoritative PayAlly catalog on the server — never from the caller — so they cannot be altered. Adding a product already in the cart sums the quantity.',
      inputSchema: z.object({
        items: z.array(CartAddItemSchema).min(1).describe('The products to add (by productId + quantity).'),
        cartId: cartIdArg,
      }),
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ items, cartId }, ctx) => {
      try {
        const email = await requireUserEmail(ctx, auth);

        // Build each line item from TRUSTED product details (cache, or API
        // fallback). The model only chose productId/variantId/quantity.
        const resolved: ResolvedLineItem[] = [];
        for (const { productId, variantId, quantity } of items) {
          const d = await productStore.resolveLineItem(merchantIdFallback, productId, variantId);
          resolved.push({
            productId: d.productId,
            ...(d.variantId ? { variantId: d.variantId } : {}),
            name: d.name,
            quantity,
            unit_amount: { currency_code: d.currency, value: d.value },
            ...(d.sku ? { sku: d.sku } : {}),
            ...(d.url ? { url: d.url } : {}),
            ...(d.imageUrl ? { image_url: d.imageUrl } : {}),
            category: toItemCategory(d.category),
            ...(d.description ? { description: d.description } : {}),
          });
        }

        const cart = await store.addItems(email, merchantIdFallback, resolved, cartId);
        return ok({ status: 'added', added: resolved.length, cart: cartView(cart) });
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Failed to add items to the cart.');
      }
    },
  );

  // 2) UPDATE ITEMS ---------------------------------------------------------
  server.registerTool(
    'cart-update-items',
    {
      title: 'Update cart item quantity',
      description:
        'Change the quantity of an existing cart line item, targeted by its lineId. Only quantity can be changed — price, name and other line-item details are owned by the server and cannot be altered.',
      inputSchema: z.object({
        updates: z
          .array(CartItemUpdateSchema)
          .min(1)
          .describe('The line-item updates. Each must include the lineId plus the fields to change.'),
        cartId: cartIdArg,
      }),
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ updates, cartId }, ctx) => {
      try {
        const email = await requireUserEmail(ctx, auth);
        const { cart, updated, notFound } = await store.updateItems(
          email,
          merchantIdFallback,
          updates,
          cartId,
        );
        return ok({ status: 'updated', updated, notFound, cart: cartView(cart) });
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Failed to update cart items.');
      }
    },
  );

  // 3) REMOVE ITEMS ---------------------------------------------------------
  server.registerTool(
    'cart-remove-items',
    {
      title: 'Remove cart items',
      description:
        'Delete specific line items from the cart by lineId, or clear every item. Provide `lineIds` to remove specific items, or set `clearAll` to true to empty the cart (the cart itself is kept — use cart-discard to delete it entirely).',
      inputSchema: z.object({
        lineIds: z
          .array(z.string().min(1))
          .optional()
          .describe('The lineIds of items to remove. Ignored when clearAll is true.'),
        clearAll: z
          .boolean()
          .optional()
          .describe('When true, removes all items from the cart.'),
        cartId: cartIdArg,
      }),
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ lineIds, clearAll, cartId }, ctx) => {
      try {
        const email = await requireUserEmail(ctx, auth);
        if (!clearAll && (!lineIds || lineIds.length === 0)) {
          return fail('Provide lineIds to remove specific items, or set clearAll to true.');
        }
        const { cart, removed, notFound } = await store.removeItems(
          email,
          merchantIdFallback,
          { lineIds, clearAll },
          cartId,
        );
        return ok({ status: 'removed', removed, notFound, cart: cartView(cart) });
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Failed to remove cart items.');
      }
    },
  );

  // 4) DISCARD CART ---------------------------------------------------------
  server.registerTool(
    'cart-discard',
    {
      title: 'Discard cart',
      description:
        'Discard (delete) the whole cart and its active-cart pointer. Omit cartId to discard the buyer\'s active cart.',
      inputSchema: z.object({ cartId: cartIdArg }),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    },
    async ({ cartId }, ctx) => {
      try {
        const email = await requireUserEmail(ctx, auth);
        const discarded = await store.discardCart(email, merchantIdFallback, cartId);
        if (!discarded) {
          return ok({ status: 'noop', message: 'No cart to discard.' });
        }
        return ok({ status: 'discarded', cartId: discarded });
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Failed to discard the cart.');
      }
    },
  );

  // 5) CHECKOUT -------------------------------------------------------------
  server.registerTool(
    'checkout',
    {
      title: 'Checkout cart',
      description:
        'Check out the buyer\'s cart: sends the cart items to PayAlly to create a checkout. Items (names, prices, etc.) are read from the stored cart on the server — never from the caller — so they cannot be altered. On a successful checkout the cart is automatically discarded. Omit cartId to check out the active cart. Returns the checkout response from PayAlly.',
      inputSchema: z.object({ cartId: cartIdArg }),
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ cartId }, ctx) => {
      try {
        const email = await requireUserEmail(ctx, auth);

        // Read the cart from cache (never create one). Items are server-truth.
        const cart = await store.readCart(email, merchantIdFallback, cartId);
        if (!cart) {
          return fail(cartId ? `Cart "${cartId}" was not found.` : 'No active cart to check out.');
        }
        if (cart.items.length === 0) {
          return fail('The cart is empty.');
        }

        // Build the checkout body from the STORED items (strip internal fields).
        const items = cart.items.map(toCheckoutItem);
        const response = await createCheckout({
          userEmail: cart.userEmail,
          merchantId: cart.merchantId,
          items,
        });

        // Checkout succeeded (createCheckout throws on a non-2xx). Auto-discard
        // the cart so the buyer can't accidentally re-pay for the same items.
        // Best-effort — a cleanup hiccup must not mask a completed payment.
        try {
          await store.discardCart(email, merchantIdFallback, cart.cartId);
        } catch (cleanupErr) {
          console.warn(`[checkout] cart discard after checkout failed for ${cart.cartId}:`, cleanupErr);
        }

        // The endpoint's response IS the tool response.
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response) }],
          structuredContent:
            response && typeof response === 'object'
              ? (response as Record<string, unknown>)
              : { response },
        };
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Failed to check out the cart.');
      }
    },
  );
}
