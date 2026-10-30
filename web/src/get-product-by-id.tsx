import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./styles.css";

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { Theme } from "@astryxdesign/core/theme";
import { Card } from "@astryxdesign/core/Card";
import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Stack } from "@astryxdesign/core/Layout";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";

import { themes, defaultThemeSlug } from "./astryx-themes";
import { useToolResult } from "./useToolResult";
import { Rating, ShoppingBagGlyph, formatPrice, onImageError } from "./ui";
import type { Product, ProductImage } from "./types";

const GALLERY_WIDTH = 240;

/** Collect main image + images[], de-duplicated by url. */
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

function Thumb({
  img,
  index,
  isActive,
  title,
  onSelect,
}: {
  img: ProductImage;
  index: number;
  isActive: boolean;
  title: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Show image ${index + 1}`}
      aria-pressed={isActive}
      onClick={onSelect}
      style={{
        width: 56,
        height: 56,
        flexShrink: 0,
        padding: 0,
        cursor: "pointer",
        borderRadius: "var(--radius-container)",
        overflow: "hidden",
        background: "var(--color-background-muted)",
        border: isActive
          ? "2px solid var(--color-accent)"
          : "1px solid var(--color-border)",
        opacity: isActive ? 1 : 0.8,
      }}
    >
      <img
        src={img.url}
        alt={img.altText ?? `${title} thumbnail ${index + 1}`}
        draggable={false}
        onError={onImageError}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </button>
  );
}

function Gallery({ images, title }: { images: ProductImage[]; title: string }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
  }, [images]);

  const main = images[active] ?? images[0];

  return (
    <Stack direction="vertical" gap={2} width={GALLERY_WIDTH}>
      <AspectRatio ratio={1} fit="cover">
        <img src={main.url} alt={main.altText ?? title} onError={onImageError} />
      </AspectRatio>

      {images.length > 1 && (
        <Stack direction="horizontal" gap={2} style={{ overflowX: "auto" }}>
          {images.map((img, i) => (
            <Thumb
              key={img.url + i}
              img={img}
              index={i}
              isActive={i === active}
              title={title}
              onSelect={() => setActive(i)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <Stack direction="horizontal" gap={6} wrap="wrap">
        <Skeleton width={GALLERY_WIDTH} height={GALLERY_WIDTH} radius={3} index={0} />
        <Stack direction="vertical" gap={3} style={{ flex: 1, minWidth: 200 }}>
          <Skeleton width={80} height={20} radius="rounded" index={1} />
          <Skeleton width="75%" height={24} index={2} />
          <Skeleton width="33%" height={16} index={3} />
          <Skeleton width="25%" height={16} index={4} />
          <Skeleton width="33%" height={28} index={5} />
          <Stack direction="vertical" gap={2}>
            <Skeleton width="100%" height={14} index={6} />
            <Skeleton width="90%" height={14} index={7} />
            <Skeleton width="66%" height={14} index={8} />
          </Stack>
        </Stack>
      </Stack>
    </Card>
  );
}

function GetProductById() {
  const { data } = useToolResult<Product>();

  if (!data || !data.id) return <SkeletonCard />;

  const images = collectImages(data);
  const price = formatPrice(data.price);

  return (
    <Card>
      <Stack direction="horizontal" gap={6} wrap="wrap">
        {images.length > 0 ? (
          <Gallery images={images} title={data.title} />
        ) : (
          <Stack
            direction="vertical"
            hAlign="center"
            vAlign="center"
            width={GALLERY_WIDTH}
            height={GALLERY_WIDTH}
            style={{
              background: "var(--color-background-muted)",
              borderRadius: "var(--radius-container)",
            }}
          >
            <Icon icon={ShoppingBagGlyph} size="lg" color="disabled" />
          </Stack>
        )}

        <Stack direction="vertical" gap={2} style={{ flex: 1, minWidth: 220 }}>
          {data.category && (
            <Stack direction="horizontal">
              <Badge variant="neutral" label={data.category} />
            </Stack>
          )}

          <Heading level={3}>{data.title}</Heading>

          {data.seller && (
            <Text type="supporting" color="secondary">
              {data.seller}
            </Text>
          )}

          <Rating rating={data.rating} size="sm" />

          {price && (
            <Text type="large" weight="semibold">
              {price}
            </Text>
          )}

          {data.description && (
            <Text type="body" color="secondary">
              {data.description}
            </Text>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}

createRoot(document.getElementById("root")!).render(
  <Theme theme={themes[defaultThemeSlug]}>
    <GetProductById />
  </Theme>,
);
