import type { SVGProps } from "react";
import { Icon } from "@astryxdesign/core/Icon";
import { Stack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";

import type { Money, Product } from "./types";

/**
 * Widget-local primitives shared by both PayAlly widgets.
 *
 * Astryx's semantic icon set has no star or shopping-bag glyph, so those are
 * passed to <Icon> as SVG components (the documented escape hatch:
 * `icon={SvgComponent}`). This keeps icon sizing/color on-system while avoiding
 * an extra icon-package dependency.
 */

/* ---- SVG glyphs (fed to Astryx <Icon icon={...} />) --------------------- */

export function StarGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.77 6.2 20.84l1.1-6.46-4.69-4.58 6.49-.94L12 2.5z" />
    </svg>
  );
}

export function StarFilledGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
      <path d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.77 6.2 20.84l1.1-6.46-4.69-4.58 6.49-.94L12 2.5z" />
    </svg>
  );
}

export function ShoppingBagGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

/**
 * Inline-SVG image placeholder, swapped in via <img onError> when a product
 * image fails to load so a broken-image glyph never appears. `data:` is
 * allowlisted in the widget resource CSP for exactly this fallback.
 */
export const IMAGE_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#9a938b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  );

/** Swap in the placeholder once on load failure (guard against a swap loop). */
export function onImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  if (e.currentTarget.src !== IMAGE_PLACEHOLDER) {
    e.currentTarget.src = IMAGE_PLACEHOLDER;
  }
}

/* ---- helpers ------------------------------------------------------------ */

export function formatPrice(price?: Money): string | null {
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

/* ---- Rating (composed from Icon + Text, on-system) ---------------------- */

export function Rating({
  rating,
  size = "sm",
}: {
  rating: Product["rating"];
  size?: "xsm" | "sm" | "md";
}) {
  if (!rating || typeof rating.value !== "number") return null;
  const rounded = Math.round(rating.value);

  return (
    <Stack direction="horizontal" gap={1} vAlign="center">
      <Stack direction="horizontal" gap={0.5} vAlign="center">
        {[0, 1, 2, 3, 4].map((i) => (
          <Icon
            key={i}
            icon={i < rounded ? StarFilledGlyph : StarGlyph}
            size={size}
            color={i < rounded ? "primary" : "disabled"}
          />
        ))}
      </Stack>
      {typeof rating.count === "number" && (
        <Text type="supporting" color="secondary">
          {rating.value.toFixed(1)} ({rating.count})
        </Text>
      )}
    </Stack>
  );
}
