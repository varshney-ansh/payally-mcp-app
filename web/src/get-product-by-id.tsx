import "./styles.css";

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { Image } from "@openai/apps-sdk-ui/components/Image";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { EmptyMessage } from "@openai/apps-sdk-ui/components/EmptyMessage";
import {
  ShoppingBag,
  Star,
  StarFilled,
} from "@openai/apps-sdk-ui/components/Icon";

import { useToolResult } from "./useToolResult";
import type { Money, Product, ProductImage } from "./types";

/**
 * Collects every image for a product: the main `image` first, then the
 * `images[]` array, de-duplicated by url. Falls back to `[image]` when
 * `images[]` is empty.
 */
function collectImages(product: Product): ProductImage[] {
  const all: ProductImage[] = [];
  if (product.image?.url) all.push(product.image);
  for (const img of product.images ?? []) {
    if (img?.url) all.push(img);
  }
  const seen = new Set<string>();
  return all.filter((img) => {
    if (seen.has(img.url)) return false;
    seen.add(img.url);
    return true;
  });
}

function formatPrice(price?: Money): string | null {
  if (!price || typeof price.amount !== "number") return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: price.currency || "USD",
    }).format(price.amount);
  } catch {
    return `${price.amount} ${price.currency ?? ""}`.trim();
  }
}

function Rating({ rating }: { rating: Product["rating"] }) {
  if (!rating || typeof rating.value !== "number") return null;
  const rounded = Math.round(rating.value);
  const stars = [0, 1, 2, 3, 4].map((i) =>
    i < rounded ? (
      <StarFilled key={i} width={16} height={16} />
    ) : (
      <Star key={i} width={16} height={16} />
    ),
  );
  return (
    <div className="flex items-center gap-1.5 text-sm text-token-text-secondary">
      <span className="flex items-center gap-0.5 text-amber-500">{stars}</span>
      {typeof rating.count === "number" && (
        <span>{rating.value.toFixed(1)} ({rating.count})</span>
      )}
    </div>
  );
}

function Gallery({
  images,
  title,
}: {
  images: ProductImage[];
  title: string;
}) {
  const [active, setActive] = useState(0);

  // Reset the active image whenever the underlying image set changes.
  useEffect(() => {
    setActive(0);
  }, [images]);

  const main = images[active] ?? images[0];

  return (
    <div className="flex w-full shrink-0 flex-col gap-2 sm:w-56">
      <div className="aspect-square w-full overflow-hidden rounded-xl bg-token-surface-secondary">
        <Image
          src={main.url}
          alt={main.altText ?? title}
          className="h-full w-full object-cover"
        />
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.url + i}
              type="button"
              aria-label={`Show image ${i + 1}`}
              aria-pressed={i === active}
              onClick={() => setActive(i)}
              className={`aspect-square h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-token-surface-secondary transition ${
                i === active
                  ? "border-token-border-heavy ring-2 ring-token-border-heavy"
                  : "border-token-border-default opacity-80 hover:opacity-100"
              }`}
            >
              <Image
                src={img.url}
                alt={img.altText ?? `${title} thumbnail ${i + 1}`}
                draggable={false}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GetProductById() {
  const { data } = useToolResult<Product>();

  if (!data || !data.id) {
    return (
      <EmptyMessage>
        <EmptyMessage.Icon>
          <ShoppingBag />
        </EmptyMessage.Icon>
        <EmptyMessage.Title>Loading product…</EmptyMessage.Title>
        <EmptyMessage.Description>
          The product details will appear here.
        </EmptyMessage.Description>
      </EmptyMessage>
    );
  }

  const images = collectImages(data);
  const price = formatPrice(data.price);

  return (
    <div className="p-2">
      <div className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-token-border-default bg-token-surface-primary p-4 sm:flex-row">
        {images.length > 0 ? (
          <Gallery images={images} title={data.title} />
        ) : (
          <div className="flex aspect-square w-full shrink-0 items-center justify-center rounded-xl bg-token-surface-secondary text-token-text-tertiary sm:w-56">
            <ShoppingBag width={40} height={40} />
          </div>
        )}

        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {data.category && (
              <Badge color="discovery" variant="soft">
                {data.category}
              </Badge>
            )}
          </div>

          <h2 className="text-lg font-semibold text-token-text-primary">
            {data.title}
          </h2>

          {data.seller && (
            <div className="text-sm text-token-text-secondary">
              {data.seller}
            </div>
          )}

          <Rating rating={data.rating} />

          {price && (
            <div className="text-xl font-semibold text-token-text-primary">
              {price}
            </div>
          )}

          {data.description && (
            <p className="mt-1 text-sm leading-relaxed text-token-text-secondary">
              {data.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<GetProductById />);
