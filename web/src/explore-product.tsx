import "./styles.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import useEmblaCarousel from "embla-carousel-react";

import { EmptyMessage } from "@openai/apps-sdk-ui/components/EmptyMessage";
import {
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Star,
  StarFilled,
} from "@openai/apps-sdk-ui/components/Icon";

import { useToolResult } from "./useToolResult";
import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { Money, Product } from "./types";

interface ExploreOutput {
  query: string;
  products: Product[];
  nextPageToken?: string;
}

/**
 * Neutral inline-SVG placeholder (mishmash achromatic: bone #f2f2f2 background,
 * graphite #a1a1a1 ShoppingBag glyph). Swapped in via <img onError> when the
 * original image url is blocked by the host CSP or fails to load, so a broken
 * image never shows the browser's broken-image glyph. data: is allowlisted in
 * the resource CSP resourceDomains for exactly this fallback.
 */
const IMAGE_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#a1a1a1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="background:#f2f2f2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  );

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

/**
 * Opens a product via the standard ext-apps bridge.
 *
 * BUG 3 root cause: the old version gated the `callServerTool` attempt behind
 * `if (app.getHostCapabilities()?.serverTools)`. Claude Desktop proxies tool
 * calls for the widget WITHOUT advertising a `serverTools` host capability, so
 * that gate was always false — the tool call never ran, and because the
 * `sendMessage` fallback was INSIDE the gate it never ran either. The click was
 * a silent no-op.
 *
 * Fix: never hard-gate on `getHostCapabilities()?.serverTools`. ALWAYS attempt
 * `callServerTool` (the host proxies it; it resolves after the handshake), and
 * on a thrown error OR a result with `isError`, fall back to `sendMessage`.
 * Both signatures match `app.d.ts`:
 *   callServerTool(params: CallToolRequest["params"], options?)
 *   sendMessage(params: McpUiMessageRequest["params"], options?)
 */
async function openProduct(app: App | null, productId: string): Promise<void> {
  if (!app) return;

  try {
    const result = await app.callServerTool({
      name: "getproductbyid",
      arguments: { productId },
    });
    if (!result.isError) return;
    // Tool reported an error — fall through to the message fallback.
  } catch {
    // Transport/host failure — fall through to the message fallback.
  }

  try {
    await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: `Show me product ${productId}` }],
    });
  } catch {
    // Nothing more we can do from the widget; swallow so the UI stays stable.
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
    <div className="flex items-center gap-1 text-caption text-iron">
      {/* Stars stay achromatic (ink filled / smoke empty) — amber is reserved for pills. */}
      <span className="flex items-center gap-0.5 text-ink">{stars}</span>
      {typeof rating.count === "number" && (
        <span className="text-iron">({rating.count})</span>
      )}
    </div>
  );
}

/**
 * Image slot. Renders the product's ORIGINAL image url directly (allowlisted
 * via the resource CSP) — no client-side fetch/encode. If the host blocks the
 * image or it fails to load, onError swaps in the inline-SVG placeholder so a
 * broken-image glyph never appears (the guard prevents a swap loop).
 */
function CardImage({ product }: { product: Product }) {
  const imageUrl = product.image?.url ?? product.images?.[0]?.url;

  return (
    <div className="aspect-square w-full overflow-hidden rounded-card bg-bone">
      {!imageUrl ? (
        <div className="flex h-full w-full items-center justify-center text-graphite">
          <ShoppingBag width={32} height={32} />
        </div>
      ) : (
        <img
          src={imageUrl}
          alt={product.image?.altText ?? product.title}
          draggable={false}
          onError={(e) => {
            if (e.currentTarget.src !== IMAGE_PLACEHOLDER) {
              e.currentTarget.src = IMAGE_PLACEHOLDER;
            }
          }}
          className="h-full w-full rounded-card object-cover"
        />
      )}
    </div>
  );
}

function ProductCard({
  product,
  onOpen,
  canOpen,
}: {
  product: Product;
  onOpen: (productId: string) => void;
  canOpen: boolean;
}) {
  const price = formatPrice(product.price);

  const activate = () => {
    if (!canOpen) return;
    onOpen(product.id);
  };

  return (
    <div
      role="button"
      tabIndex={canOpen ? 0 : -1}
      aria-disabled={!canOpen}
      aria-label={`Show details for ${product.title}`}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      className={`shrink-0 basis-[220px] overflow-hidden rounded-card border border-ash bg-paper-white p-2 transition ${
        canOpen
          ? "cursor-pointer hover:border-ink active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-tag"
          : "cursor-default"
      }`}
    >
      <CardImage product={product} />
      <div className="flex flex-col gap-2 p-2">
        <div className="line-clamp-2 text-body font-medium text-ink">
          {product.title}
        </div>
        {product.seller && (
          <div className="truncate text-body-sm text-iron">{product.seller}</div>
        )}
        {price && (
          <div className="mt-0.5 text-body-sm text-ink">{price}</div>
        )}
        <Rating rating={product.rating} />
      </div>
    </div>
  );
}

/** A single pulsing placeholder card shown while the tool result is pending. */
function SkeletonCard() {
  return (
    <div className="shrink-0 basis-[220px] overflow-hidden rounded-card border border-ash bg-paper-white p-2">
      <div className="aspect-square w-full animate-pulse rounded-card bg-bone" />
      <div className="flex flex-col gap-2 p-2">
        <div className="h-3.5 w-4/5 animate-pulse rounded-card bg-bone" />
        <div className="h-3 w-2/5 animate-pulse rounded-card bg-bone" />
        <div className="h-3.5 w-1/3 animate-pulse rounded-card bg-bone" />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="w-full p-2">
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

function ExploreProduct() {
  const { data, app } = useToolResult<ExploreOutput>();
  const products = Array.isArray(data?.products) ? data!.products : [];
  const canOpen = app != null;

  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    dragFree: true,
    containScroll: "trimSnaps",
    loop: false,
  });

  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  // Suppress the click that fires at the end of a drag so dragging the
  // carousel never accidentally opens a product.
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

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

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    draggedRef.current = false;
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    const start = pointerStart.current;
    if (!start) return;
    if (Math.abs(e.clientX - start.x) > 6 || Math.abs(e.clientY - start.y) > 6) {
      draggedRef.current = true;
    }
  };

  const openIfNotDragging = (productId: string) => {
    if (draggedRef.current) return;
    void openProduct(app, productId);
  };

  // Tool result not yet delivered: show a skeleton carousel row.
  if (!data) {
    return <SkeletonRow />;
  }

  // Data arrived but there are genuinely no products.
  if (products.length === 0) {
    return (
      <EmptyMessage>
        <EmptyMessage.Icon>
          <ShoppingBag />
        </EmptyMessage.Icon>
        <EmptyMessage.Title>
          <span className="text-ink">No products to show</span>
        </EmptyMessage.Title>
        <EmptyMessage.Description>
          <span className="text-iron">
            {data.query
              ? `Nothing matched “${data.query}”.`
              : "Results will appear here once the search runs."}
          </span>
        </EmptyMessage.Description>
      </EmptyMessage>
    );
  }

  return (
    <div className="relative w-full p-2">
      <div
        className="overflow-hidden"
        ref={emblaRef}
        onPointerDownCapture={handlePointerDown}
        onPointerMoveCapture={handlePointerMove}
      >
        <div className="flex gap-3">
          {products.map((product, i) => (
            <ProductCard
              key={product.id ?? i}
              product={product}
              onOpen={openIfNotDragging}
              canOpen={canOpen}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        aria-label="Previous"
        onClick={() => emblaApi?.scrollPrev()}
        disabled={!canScrollPrev}
        className="absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-pill border border-ash bg-paper-white text-ink transition disabled:pointer-events-none disabled:opacity-0"
      >
        <ChevronLeft width={18} height={18} />
      </button>
      <button
        type="button"
        aria-label="Next"
        onClick={() => emblaApi?.scrollNext()}
        disabled={!canScrollNext}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-pill border border-ash bg-paper-white text-ink transition disabled:pointer-events-none disabled:opacity-0"
      >
        <ChevronRight width={18} height={18} />
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<ExploreProduct />);
