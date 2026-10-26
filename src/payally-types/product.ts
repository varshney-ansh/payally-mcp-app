/**
 * Unified PayAlly product.
 *
 * Whatever the source (Shopify, Channel3), we map into this one shape so the
 * customer sees a consistent product and devs work against a single model
 * for cart / order / invoice.
 */

export interface Money {
  amount: number;   // 68.25
  currency: string; // "USD"
}

export interface ProductImage {
  url: string;
  altText?: string;
}

/** A value the customer can pick, e.g. a size, denomination or color. */
export interface ProductVariant {
  id: string;
  title: string;          // "$25", "Black/Metallic Silver", "US 10"
  price: Money;
  compareAtPrice?: Money; // original price, if on sale
  image?: ProductImage;   // variant thumbnail, when the source has one
}

export interface Product {
  id: string;

  title: string;
  description?: string;
  seller?: string;

  image?: ProductImage;    // main image
  images: ProductImage[];

  category?: string;       // "Sneakers"
  price: Money;            // default / starting price

  /** What the customer picks. Always has at least one entry. */
  variants: ProductVariant[];

  rating?: { value: number; count: number };
}

