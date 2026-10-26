import "./styles.css";

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import useEmblaCarousel from "embla-carousel-react";

import { Image } from "@openai/apps-sdk-ui/components/Image";
import { EmptyMessage } from "@openai/apps-sdk-ui/components/EmptyMessage";
import {
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Star,
  StarFilled,
} from "@openai/apps-sdk-ui/components/Icon";

import { useToolResult } from "./useToolResult";
import type { Money, Product } from "./types";

interface ExploreOutput {
  query: string;
  products: Product[];
  nextPageToken?: string;
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
      <StarFilled key={i} width={14} height={14} />
    ) : (
      <Star key={i} width={14} height={14} />
    ),
  );
  return (
    <div className="flex items-center gap-1 text-xs text-token-text-secondary">
      <span className="flex items-center gap-0.5 text-amber-500">{stars}</span>
      {typeof rating.count === "number" && (
        <span>({rating.count})</span>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const imageUrl = product.image?.url ?? product.images?.[0]?.url;
  const price = formatPrice(product.price);

  return (
    <div className="shrink-0 basis-[220px] overflow-hidden rounded-2xl border border-token-border-default bg-token-surface-primary">
      <div className="aspect-square w-full overflow-hidden bg-token-surface-secondary">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={product.image?.altText ?? product.title}
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-token-text-tertiary">
            <ShoppingBag width={32} height={32} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <div className="line-clamp-2 text-sm font-medium text-token-text-primary">
          {product.title}
        </div>
        {product.seller && (
          <div className="truncate text-xs text-token-text-secondary">
            {product.seller}
          </div>
        )}
        {price && (
          <div className="mt-0.5 text-sm font-semibold text-token-text-primary">
            {price}
          </div>
        )}
        <Rating rating={product.rating} />
      </div>
    </div>
  );
}

function ExploreProduct() {
  const { data } = useToolResult<ExploreOutput>();
  const products = Array.isArray(data?.products) ? data!.products : [];

  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    dragFree: true,
    containScroll: "trimSnaps",
    loop: false,
  });

  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect).on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect).off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  if (!data || products.length === 0) {
    return (
      <EmptyMessage>
        <EmptyMessage.Icon>
          <ShoppingBag />
        </EmptyMessage.Icon>
        <EmptyMessage.Title>No products to show</EmptyMessage.Title>
        <EmptyMessage.Description>
          {data?.query
            ? `Nothing matched “${data.query}”.`
            : "Results will appear here once the search runs."}
        </EmptyMessage.Description>
      </EmptyMessage>
    );
  }

  return (
    <div className="relative w-full p-2">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-3">
          {products.map((product, i) => (
            <ProductCard key={product.id ?? i} product={product} />
          ))}
        </div>
      </div>

      <button
        type="button"
        aria-label="Previous"
        onClick={() => emblaApi?.scrollPrev()}
        disabled={!canScrollPrev}
        className="absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-token-border-default bg-token-surface-primary shadow-sm transition disabled:pointer-events-none disabled:opacity-0"
      >
        <ChevronLeft width={18} height={18} />
      </button>
      <button
        type="button"
        aria-label="Next"
        onClick={() => emblaApi?.scrollNext()}
        disabled={!canScrollNext}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-token-border-default bg-token-surface-primary shadow-sm transition disabled:pointer-events-none disabled:opacity-0"
      >
        <ChevronRight width={18} height={18} />
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<ExploreProduct />);
