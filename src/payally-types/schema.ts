import { z } from 'zod';

/** Zod schemas that mirror the unified PayAlly `Product` type. */

export const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string(),
});

export const ProductImageSchema = z.object({
  url: z.string(),
  altText: z.string().optional(),
});

export const ProductVariantSchema = z.object({
  id: z.string(),
  title: z.string(),
  price: MoneySchema,
  compareAtPrice: MoneySchema.optional(),
  image: ProductImageSchema.optional(),
});

export const ProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  seller: z.string().optional(),
  image: ProductImageSchema.optional(),
  images: z.array(ProductImageSchema).default([]),
  category: z.string().optional(),
  price: MoneySchema,
  variants: z.array(ProductVariantSchema).default([]),
  rating: z.object({ value: z.number(), count: z.number() }).optional(),
});
