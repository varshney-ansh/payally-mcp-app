import type { Product } from './product.js';

/** Shape returned by GET /v1/explore-products. */
export interface ExploreProductsResponse {
  products: Product[];
  nextPageToken?: string;
}

/** A single product is returned directly by GET /v1/get-product-by-id. */
export type GetProductByIdResponse = Product;
