import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./styles.css";

import { createRoot } from "react-dom/client";

import { Theme } from "@astryxdesign/core/theme";
import { Card } from "@astryxdesign/core/Card";
import { List, ListItem } from "@astryxdesign/core/List";
import { Stack } from "@astryxdesign/core/Layout";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { EmptyState } from "@astryxdesign/core/EmptyState";

import { themes, defaultThemeSlug } from "./astryx-themes";
import { useToolResult } from "./useToolResult";
import { ShoppingBagGlyph } from "./ui";
import { money, shortDate, grandWithFee, StatusBadge } from "./order-ui";
import type { OrderDetailOutput, Order } from "./types";

function TotalsRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="horizontal" gap={2} hAlign="between" vAlign="center">
      <Text type={strong ? "body" : "supporting"} weight={strong ? "semibold" : "normal"} color={strong ? "primary" : "secondary"}>
        {label}
      </Text>
      <Text type={strong ? "body" : "supporting"} weight={strong ? "semibold" : "normal"} color={strong ? "primary" : "secondary"}>
        {value}
      </Text>
    </Stack>
  );
}

function OrderDetailView({ order }: { order: Order }) {
  const currency = order.currencyCode;
  const hasFee = order.platformFee != null && order.platformFee !== "";

  return (
    <Card>
      <Stack direction="vertical" gap={4}>
        {/* Header */}
        <Stack direction="horizontal" gap={2} hAlign="between" vAlign="start">
          <Stack direction="vertical" gap={1} style={{ minWidth: 0 }}>
            <Heading level={4}>Order {order.id}</Heading>
            <Text type="supporting" color="secondary">
              {shortDate(order.createdAt)}
              {order.payerName ? ` · ${order.payerName}` : ""}
            </Text>
          </Stack>
          <StatusBadge status={order.status} />
        </Stack>

        {/* Line items */}
        <List header={<Text type="label" color="secondary">Items</Text>} hasDividers edge="bleed">
          {(order.items ?? []).map((item, i) => (
            <ListItem
              key={i}
              label={item.name}
              description={
                [
                  `Qty ${item.quantity}`,
                  item.sku ? `SKU ${item.sku}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
              endContent={
                <Text type="body" weight="medium">
                  {money(item.unitAmount, currency)}
                </Text>
              }
            />
          ))}
        </List>

        {/* Totals. PayPal does NOT fold the platform fee into grandTotal (it's
            deducted from the merchant's side), so the amount the buyer pays =
            item total + platform fee. Compute it rather than trusting the
            endpoint's grandTotal field. */}
        <Stack direction="vertical" gap={1}>
          <TotalsRow label="Item total" value={money(order.itemTotal, currency)} />
          {hasFee && <TotalsRow label="Platform fee" value={money(order.platformFee, currency)} />}
          <TotalsRow label="Total paid" value={money(grandWithFee(order), currency)} strong />
        </Stack>
      </Stack>
    </Card>
  );
}

function SkeletonDetail() {
  return (
    <Card>
      <Stack direction="vertical" gap={4}>
        <Stack direction="horizontal" gap={2} hAlign="between">
          <Stack direction="vertical" gap={1}>
            <Skeleton width={180} height={22} index={0} />
            <Skeleton width={120} height={14} index={1} />
          </Stack>
          <Skeleton width={80} height={22} radius="rounded" index={2} />
        </Stack>
        <Stack direction="vertical" gap={2}>
          {[3, 4].map((i) => (
            <Stack key={i} direction="horizontal" gap={2} hAlign="between">
              <Skeleton width="55%" height={16} index={i} />
              <Skeleton width={64} height={16} index={i} />
            </Stack>
          ))}
        </Stack>
        <Stack direction="vertical" gap={1}>
          <Skeleton width="100%" height={14} index={5} />
          <Skeleton width="100%" height={18} index={6} />
        </Stack>
      </Stack>
    </Card>
  );
}

function OrderDetail() {
  const { data } = useToolResult<OrderDetailOutput>();

  if (!data || !data.order) return <SkeletonDetail />;

  const order = data.order;
  if (!order.id) {
    return (
      <EmptyState
        icon={<Icon icon={ShoppingBagGlyph} size="lg" />}
        title="Order not found"
        description="We couldn't find details for this order."
      />
    );
  }

  return (
    <Stack direction="vertical" style={{ padding: "var(--spacing-2)" }}>
      <OrderDetailView order={order} />
    </Stack>
  );
}

createRoot(document.getElementById("root")!).render(
  <Theme theme={themes[defaultThemeSlug]}>
    <OrderDetail />
  </Theme>,
);
