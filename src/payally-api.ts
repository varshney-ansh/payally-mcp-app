import type { ExploreProductsResponse, GetProductByIdResponse } from './payally-types/api.js';

const API_BASE = process.env.PAYALLY_API_BASE ?? 'https://api.payally.world/v1';

/**
 * Thin client for the PayAlly storefront API.
 *
 * The merchant id is always supplied by the server (from the authenticated
 * user's token or the PAYPAL_MERCHANT_ID env var) and is never accepted as a
 * tool argument, so it stays out of the model's and the client's reach.
 */

async function getJson<T>(url: URL): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PayAlly API ${res.status} ${res.statusText} for ${url.pathname}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/** Search the catalog. `query` is the only caller-supplied value. */
export async function exploreProducts(
  query: string,
  merchantId: string,
  opts: { minPrice?: number; maxPrice?: number } = {},
): Promise<ExploreProductsResponse> {
  const url = new URL(`${API_BASE}/explore-products`);
  url.searchParams.set('query', query);
  url.searchParams.set('merchantid', merchantId);
  if (opts.minPrice !== undefined) url.searchParams.set('min_price', String(opts.minPrice));
  if (opts.maxPrice !== undefined) url.searchParams.set('max_price', String(opts.maxPrice));
  return getJson<ExploreProductsResponse>(url);
}

/** Look up a single product by its id. */
export async function getProductById(productId: string, merchantId: string): Promise<GetProductByIdResponse> {
  const url = new URL(`${API_BASE}/get-product-by-id`);
  url.searchParams.set('productId', productId);
  url.searchParams.set('merchantid', merchantId);
  return getJson<GetProductByIdResponse>(url);
}
