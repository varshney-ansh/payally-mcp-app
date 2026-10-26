/**
 * Product model duplicated from src/payally-types/product.ts.
 *
 * web/ lives outside the server's tsconfig rootDir (./src), so we cannot import
 * from ../src. These plain interfaces type the structuredContent the widgets
 * receive from the MCP Apps tool-result notification.
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
