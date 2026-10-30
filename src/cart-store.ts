import { randomUUID } from 'node:crypto';
import { TimeUnit } from '@valkey/valkey-glide';
import type { GlideClusterClient } from '@valkey/valkey-glide';
import type { Cart, CartItemUpdate, CartLineItem } from './payally-types/cart.js';

/** A fully server-built line item (no lineId yet) ready to add to a cart. */
export type ResolvedLineItem = Omit<CartLineItem, 'lineId'>;

/**
 * Valkey-backed cart store.
 *
 * Key layout (per the required scheme):
 *   cart:      `${userEmail}:${merchantId}:${cartId}`      -> JSON Cart document
 *   active ptr `${userEmail}:${merchantId}:active-cart`    -> cartId of the active cart
 *
 * `userEmail` is the authenticated buyer's email, resolved from the Auth0
 * profile (Management API lookup by `sub`) in the tool layer — it is always
 * present. The active-cart pointer lets tools operate on "the active cart"
 * without the model tracking a cart id across turns: a tool called with no
 * cartId resolves (or lazily creates) the active cart for that user+merchant.
 *
 * Carts are persisted as JSON strings with a TTL so abandoned carts expire.
 */

/** 30 days — abandoned carts expire rather than living forever in the cache. */
const CART_TTL_SECONDS = 60 * 60 * 24 * 30;

export class CartStore {
  constructor(
    private readonly client: GlideClusterClient,
    private readonly ttlSeconds: number = CART_TTL_SECONDS,
  ) {}

  private cartKey(userEmail: string, merchantId: string, cartId: string): string {
    return `${userEmail}:${merchantId}:${cartId}`;
  }

  private activePtrKey(userEmail: string, merchantId: string): string {
    return `${userEmail}:${merchantId}:active-cart`;
  }

  /** Reads a cart by id, or null if it does not exist. */
  async getCart(userEmail: string, merchantId: string, cartId: string): Promise<Cart | null> {
    const raw = await this.client.get(this.cartKey(userEmail, merchantId, cartId));
    if (raw == null) return null;
    try {
      return JSON.parse(raw.toString()) as Cart;
    } catch {
      return null;
    }
  }

  /** Persists a cart (with TTL) and returns it. */
  private async putCart(cart: Cart): Promise<Cart> {
    cart.updatedAt = new Date().toISOString();
    await this.client.set(
      this.cartKey(cart.userEmail, cart.merchantId, cart.cartId),
      JSON.stringify(cart),
      { expiry: { type: TimeUnit.Seconds, count: this.ttlSeconds } },
    );
    return cart;
  }

  /** Returns the active cart id for a user+merchant, or null. */
  private async getActiveCartId(userEmail: string, merchantId: string): Promise<string | null> {
    const raw = await this.client.get(this.activePtrKey(userEmail, merchantId));
    return raw == null ? null : raw.toString();
  }

  private async setActiveCartId(userEmail: string, merchantId: string, cartId: string): Promise<void> {
    await this.client.set(this.activePtrKey(userEmail, merchantId), cartId, {
      expiry: { type: TimeUnit.Seconds, count: this.ttlSeconds },
    });
  }

  private newCart(userEmail: string, merchantId: string): Cart {
    const now = new Date().toISOString();
    return {
      cartId: randomUUID(),
      userEmail,
      merchantId,
      items: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Resolves the cart to operate on:
   *  - explicit cartId provided -> that cart (throws if it does not exist)
   *  - no cartId -> the active cart, creating a fresh one if none exists.
   * Returns the resolved cart (persisted if newly created) and whether it was
   * created in this call.
   */
  async resolveActiveCart(
    userEmail: string,
    merchantId: string,
    cartId?: string,
  ): Promise<{ cart: Cart; created: boolean }> {
    if (cartId) {
      const cart = await this.getCart(userEmail, merchantId, cartId);
      if (!cart) throw new Error(`Cart "${cartId}" was not found.`);
      return { cart, created: false };
    }

    const activeId = await this.getActiveCartId(userEmail, merchantId);
    if (activeId) {
      const cart = await this.getCart(userEmail, merchantId, activeId);
      if (cart) return { cart, created: false };
      // Dangling pointer (cart expired) — fall through and create a new one.
    }

    const cart = await this.putCart(this.newCart(userEmail, merchantId));
    await this.setActiveCartId(userEmail, merchantId, cart.cartId);
    return { cart, created: true };
  }

  /**
   * Adds SERVER-BUILT line items to the active (or specified) cart. Items are
   * matched by productId + variantId; a match has its quantity summed,
   * otherwise a new line item is appended with a fresh lineId. The caller
   * (tool layer) has already built each item from trusted product details —
   * the store never trusts model-supplied price/name/etc.
   */
  async addItems(
    userEmail: string,
    merchantId: string,
    items: ResolvedLineItem[],
    cartId?: string,
  ): Promise<Cart> {
    const { cart } = await this.resolveActiveCart(userEmail, merchantId, cartId);

    for (const item of items) {
      const existing = cart.items.find((line) => this.sameItem(line, item));
      if (existing) {
        existing.quantity = String(Number(existing.quantity) + Number(item.quantity));
      } else {
        const line: CartLineItem = { ...item, lineId: randomUUID() };
        cart.items.push(line);
      }
    }

    return this.putCart(cart);
  }

  /** Two items are "the same" product when productId (and variantId) match. */
  private sameItem(line: CartLineItem, item: ResolvedLineItem): boolean {
    return line.productId === item.productId && line.variantId === item.variantId;
  }

  /**
   * Updates the QUANTITY of existing line items in place (matched by lineId).
   * Price/name/attributes are server-owned and are NOT changeable here.
   * Unknown lineIds are collected and reported back.
   */
  async updateItems(
    userEmail: string,
    merchantId: string,
    updates: CartItemUpdate[],
    cartId?: string,
  ): Promise<{ cart: Cart; updated: string[]; notFound: string[] }> {
    const { cart } = await this.resolveActiveCart(userEmail, merchantId, cartId);
    const updated: string[] = [];
    const notFound: string[] = [];

    for (const { lineId, quantity } of updates) {
      const line = cart.items.find((l) => l.lineId === lineId);
      if (!line) {
        notFound.push(lineId);
        continue;
      }
      line.quantity = quantity;
      updated.push(lineId);
    }

    const saved = await this.putCart(cart);
    return { cart: saved, updated, notFound };
  }

  /**
   * Removes specific line items by id. When `clearAll` is true, removes every
   * item (empties the cart but keeps the cart itself). Returns the resulting
   * cart plus which ids were removed / not found.
   */
  async removeItems(
    userEmail: string,
    merchantId: string,
    opts: { lineIds?: string[]; clearAll?: boolean },
    cartId?: string,
  ): Promise<{ cart: Cart; removed: string[]; notFound: string[] }> {
    const { cart } = await this.resolveActiveCart(userEmail, merchantId, cartId);

    if (opts.clearAll) {
      const removed = cart.items.map((l) => l.lineId);
      cart.items = [];
      const saved = await this.putCart(cart);
      return { cart: saved, removed, notFound: [] };
    }

    const lineIds = opts.lineIds ?? [];
    const present = new Set(cart.items.map((l) => l.lineId));
    const removed = lineIds.filter((id) => present.has(id));
    const notFound = lineIds.filter((id) => !present.has(id));
    cart.items = cart.items.filter((l) => !removed.includes(l.lineId));

    const saved = await this.putCart(cart);
    return { cart: saved, removed, notFound };
  }

  /**
   * Discards a whole cart: deletes the cart key and, if it was the active
   * cart, clears the active-cart pointer. Returns the deleted cart id (or null
   * if there was nothing to discard).
   */
  async discardCart(userEmail: string, merchantId: string, cartId?: string): Promise<string | null> {
    const targetId = cartId ?? (await this.getActiveCartId(userEmail, merchantId));
    if (!targetId) return null;

    await this.client.del([this.cartKey(userEmail, merchantId, targetId)]);

    const activeId = await this.getActiveCartId(userEmail, merchantId);
    if (activeId === targetId) {
      await this.client.del([this.activePtrKey(userEmail, merchantId)]);
    }
    return targetId;
  }
}
