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

/** A PayPal-shaped order item sent to checkout (no internal cart fields). */
export interface CheckoutItem {
  name: string;
  quantity: string;
  unit_amount: { currency_code: string; value: string };
  tax?: { currency_code: string; value: string };
  sku?: string;
  url?: string;
  image_url?: string;
  category?: string;
  description?: string;
  upc?: { type: string; code: string };
  billing_plan?: Record<string, unknown>;
}

/**
 * POSTs JSON to a PayAlly endpoint and returns the parsed response. Shared by
 * the checkout + order tools. Throws with status + body on a non-2xx so the
 * caller can surface a clear error.
 */
async function postJson(path: string, body: unknown, label: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text; // non-JSON response — surface the raw text
  }
  if (!res.ok) {
    throw new Error(
      `PayAlly ${label} ${res.status} ${res.statusText}: ${
        typeof parsed === 'string' ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500)
      }`,
    );
  }
  return parsed;
}

/**
 * Creates a checkout for the given buyer + merchant with the cart's items.
 * POSTs to `v1/checkout` and returns whatever the endpoint responds with
 * (parsed JSON) — that becomes the tool's response.
 */
export async function createCheckout(body: {
  userEmail: string;
  merchantId: string;
  items: CheckoutItem[];
}): Promise<unknown> {
  return postJson('checkout', body, 'checkout');
}

/** Lists the orders a buyer placed with a merchant. POSTs to `v1/show-orders`. */
export async function listOrders(body: { merchantId: string; email: string }): Promise<unknown> {
  return postJson('show-orders', body, 'show-orders');
}

/** Fetches one order's details. POSTs to `v1/show-order-by-id`. */
export async function getOrderById(body: {
  merchantId: string;
  email: string;
  orderId: string;
}): Promise<unknown> {
  return postJson('show-order-by-id', body, 'show-order-by-id');
}
