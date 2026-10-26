import "./styles.css";

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
import type { Money, Product } from "./types";

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

  const imageUrl = data.image?.url ?? data.images?.[0]?.url;
  const price = formatPrice(data.price);

  return (
    <div className="p-2">
      <div className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-token-border-default bg-token-surface-primary sm:flex-row">
        <div className="aspect-square w-full shrink-0 overflow-hidden bg-token-surface-secondary sm:w-56">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={data.image?.altText ?? data.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-token-text-tertiary">
              <ShoppingBag width={40} height={40} />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
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
