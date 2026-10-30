import { TimeUnit } from '@valkey/valkey-glide';
import type { GlideClusterClient } from '@valkey/valkey-glide';
import type { Product } from './payally-types/product.js';
import { getProductById } from './payally-api.js';

/**
 * Valkey-backed authoritative product-details cache.
 *
 * WHY: the AI model must NEVER set or alter line-item data (price, name, etc.).
 * The product tools (explore-product / getproductbyid) cache each product's
 * server-truth snapshot here keyed `merchantId:productId` (and per variant).
 * `cart-add-items` then takes ONLY a productId (+ quantity / optional variant)
 * and builds the whole PayPal order item from this trusted snapshot — the model
 * can choose WHAT to add, never its price or details.
 *
 * FALLBACK: if a product was never viewed / the cache expired, the cart tool
 * calls `resolveLineItem`, which fetches the product from the PayAlly API,
 * caches it, and returns the trusted snapshot. So add-to-cart works even
 * without a prior explore/get call.
 */

/** 24h — spans a browse→add session; re-cached on each product view. */
const DETAILS_TTL_SECONDS = 60 * 60 * 24;

/** The server-truth product snapshot cached per product (and per variant). */
export interface ProductDetails {
  productId: string;
  /** Present when the snapshot is for a specific variant. */
  variantId?: string;
  name: string;
  /** PayPal-money shaped decimal string, e.g. "110.00". */
  value: string;
  currency: string;
  sku?: string;
  url?: string;
  imageUrl?: string;
  category?: string;
  description?: string;
}

/** PayPal money `value` is a string; format a numeric amount to 2 dp. */
function toMoneyValue(amount: number): string {
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

export class ProductStore {
  constructor(
    private readonly client: GlideClusterClient,
    private readonly ttlSeconds: number = DETAILS_TTL_SECONDS,
  ) {}

  private key(merchantId: string, productId: string, variantId?: string): string {
    return variantId
      ? `product:${merchantId}:${productId}:${variantId}`
      : `product:${merchantId}:${productId}`;
  }

  private async put(record: ProductDetails, merchantId: string): Promise<void> {
    await this.client.set(
      this.key(merchantId, record.productId, record.variantId),
      JSON.stringify(record),
      { expiry: { type: TimeUnit.Seconds, count: this.ttlSeconds } },
    );
  }

  /** Builds the base (product-level) + per-variant snapshots for a product. */
  private snapshotsFor(product: Product): ProductDetails[] {
    const base: ProductDetails = {
      productId: product.id,
      name: product.title,
      value: toMoneyValue(product.price.amount),
      currency: product.price.currency,
      imageUrl: product.image?.url ?? product.images?.[0]?.url,
      category: product.category,
      description: product.description,
    };
    const records = [base];
    for (const v of product.variants ?? []) {
      records.push({
        productId: product.id,
        variantId: v.id,
        name: `${product.title} — ${v.title}`,
        value: toMoneyValue(v.price.amount),
        currency: v.price.currency,
        imageUrl: v.image?.url ?? base.imageUrl,
        category: product.category,
        description: product.description,
      });
    }
    return records;
  }

  /**
   * Caches the authoritative details for a product and each of its variants.
   * Called by the product tools after fetching from the PayAlly API.
   * Best-effort — failures are swallowed so a cache hiccup never breaks browsing.
   */
  async cacheProduct(product: Product, merchantId: string): Promise<void> {
    try {
      await Promise.all(this.snapshotsFor(product).map((r) => this.put(r, merchantId)));
    } catch (err) {
      console.warn(`[product-store] cacheProduct(${product.id}) failed:`, err);
    }
  }

  /** Caches a batch of products (explore-product result). Best-effort. */
  async cacheProducts(products: Product[], merchantId: string): Promise<void> {
    await Promise.all(products.map((p) => this.cacheProduct(p, merchantId)));
  }

  /** Reads a cached snapshot (product or variant), or null. */
  async get(merchantId: string, productId: string, variantId?: string): Promise<ProductDetails | null> {
    const raw = await this.client.get(this.key(merchantId, productId, variantId));
    if (raw == null) return null;
    try {
      return JSON.parse(raw.toString()) as ProductDetails;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the trusted details for a productId (+ optional variantId):
   *  1. cache hit  -> return it
   *  2. cache miss -> fetch the product from the PayAlly API, cache it, then
   *     return the requested snapshot.
   * Throws if the product (or the requested variant) does not exist.
   */
  async resolveLineItem(
    merchantId: string,
    productId: string,
    variantId?: string,
  ): Promise<ProductDetails> {
    const cached = await this.get(merchantId, productId, variantId);
    if (cached) return cached;

    // Fallback: fetch from the API and cache the whole product.
    const product = await getProductById(productId, merchantId);
    if (!product || !product.id) {
      throw new Error(`Product "${productId}" was not found.`);
    }
    await this.cacheProduct(product, merchantId);

    const fresh = await this.get(merchantId, productId, variantId);
    if (!fresh) {
      throw new Error(
        variantId
          ? `Variant "${variantId}" of product "${productId}" was not found.`
          : `Product "${productId}" was not found.`,
      );
    }
    return fresh;
  }
}
