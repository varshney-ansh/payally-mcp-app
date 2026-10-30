import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./styles.css";

import { createRoot } from "react-dom/client";

import { Theme } from "@astryxdesign/core/theme";
import { Carousel } from "@astryxdesign/core/Carousel";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Stack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { EmptyState } from "@astryxdesign/core/EmptyState";

import { themes, defaultThemeSlug } from "./astryx-themes";
import { useToolResult } from "./useToolResult";
import { Rating, ShoppingBagGlyph, formatPrice, onImageError } from "./ui";
import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { Product } from "./types";

interface ExploreOutput {
  query: string;
  products: Product[];
  nextPageToken?: string;
}

const CARD_WIDTH = 220;

/**
 * Opens a product via the standard ext-apps bridge.
 *
 * ALWAYS attempt `callServerTool` (the host proxies it) — never hard-gate on
 * `getHostCapabilities()?.serverTools`, which Claude Desktop does not advertise.
 * On a thrown error OR a result with `isError`, fall back to `sendMessage`.
 */
async function openProduct(app: App | null, productId: string): Promise<void> {
  if (!app) return;
  try {
    const result = await app.callServerTool({
      name: "getproductbyid",
      arguments: { productId },
    });
    if (!result.isError) return;
  } catch {
    // fall through to message fallback
  }
  try {
    await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: `Show me product ${productId}` }],
    });
  } catch {
    // nothing more we can do from the widget
  }
}

function ProductImage({ product }: { product: Product }) {
  const imageUrl = product.image?.url ?? product.images?.[0]?.url;

  return (
    <AspectRatio ratio={1} fit={imageUrl ? "cover" : undefined}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={product.image?.altText ?? product.title}
          draggable={false}
          onError={onImageError}
        />
      ) : (
        <Stack direction="vertical" hAlign="center" vAlign="center" height="100%">
          <Icon icon={ShoppingBagGlyph} size="lg" color="disabled" />
        </Stack>
      )}
    </AspectRatio>
  );
}

function ProductCard({
  product,
  app,
}: {
  product: Product;
  app: App | null;
}) {
  const price = formatPrice(product.price);

  return (
    <ClickableCard
      label={`Show details for ${product.title}`}
      onClick={() => void openProduct(app, product.id)}
      isDisabled={app == null}
      padding={2}
      elevation="low"
      width={CARD_WIDTH}
    >
      <Stack direction="vertical" gap={2}>
        <ProductImage product={product} />
        <Stack direction="vertical" gap={1}>
          <Text type="body" weight="medium" maxLines={2}>
            {product.title}
          </Text>
          {product.seller && (
            <Text type="supporting" color="secondary" maxLines={1}>
              {product.seller}
            </Text>
          )}
          {price && (
            <Text type="body" weight="medium">
              {price}
            </Text>
          )}
          <Rating rating={product.rating} size="xsm" />
        </Stack>
      </Stack>
    </ClickableCard>
  );
}

function SkeletonCard({ index }: { index: number }) {
  return (
    <Stack direction="vertical" gap={2} width={CARD_WIDTH}>
      <Skeleton width="100%" height={CARD_WIDTH} radius={3} index={index} />
      <Stack direction="vertical" gap={1}>
        <Skeleton width="80%" height={14} index={index} />
        <Skeleton width="40%" height={12} index={index} />
        <Skeleton width="33%" height={14} index={index} />
      </Stack>
    </Stack>
  );
}

function SkeletonRow() {
  return (
    <Stack direction="horizontal" gap={3} style={{ padding: "var(--spacing-2)" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <SkeletonCard key={i} index={i} />
      ))}
    </Stack>
  );
}

function ExploreProduct() {
  const { data, app } = useToolResult<ExploreOutput>();
  const products = Array.isArray(data?.products) ? data!.products : [];

  if (!data) return <SkeletonRow />;

  if (products.length === 0) {
    return (
      <EmptyState
        icon={<Icon icon={ShoppingBagGlyph} size="lg" />}
        title="No products to show"
        description={
          data.query
            ? `Nothing matched “${data.query}”.`
            : "Results will appear here once the search runs."
        }
      />
    );
  }

  return (
    <Carousel gap={3} hasSnap padding={2} aria-label={data.query ? `Products for ${data.query}` : "Products"}>
      {products.map((product, i) => (
        <ProductCard key={product.id ?? i} product={product} app={app} />
      ))}
    </Carousel>
  );
}

createRoot(document.getElementById("root")!).render(
  <Theme theme={themes[defaultThemeSlug]}>
    <ExploreProduct />
  </Theme>,
);
