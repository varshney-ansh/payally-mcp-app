import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./styles.css";

import { createRoot } from "react-dom/client";

import { Theme } from "@astryxdesign/core/theme";
import { Card } from "@astryxdesign/core/Card";
import { Stack } from "@astryxdesign/core/Layout";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { EmptyState } from "@astryxdesign/core/EmptyState";

import { themes, defaultThemeSlug } from "./astryx-themes";
import { useToolResult } from "./useToolResult";
import { ShoppingBagGlyph } from "./ui";
import { money, shortDate, totalUnits, grandWithFee, StatusBadge } from "./order-ui";
import type { ListOrdersOutput, Order } from "./types";

function OrderCard({ order }: { order: Order }) {
  const units = totalUnits(order);
  const names = (order.items ?? []).map((i) => i.name).filter(Boolean);
  const summary =
    names.length === 0
      ? ""
      : names.length <= 2
        ? names.join(", ")
        : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;

  return (
    <Card>
      <Stack direction="vertical" gap={2}>
        <Stack direction="horizontal" gap={2} hAlign="between" vAlign="center">
          <Text type="supporting" color="secondary">
            {shortDate(order.createdAt)}
          </Text>
          <StatusBadge status={order.status} />
        </Stack>

        <Stack direction="horizontal" gap={2} hAlign="between" vAlign="start">
          <Stack direction="vertical" gap={1} style={{ flex: 1, minWidth: 0 }}>
            {summary && (
              <Text type="body" weight="medium" maxLines={2}>
                {summary}
              </Text>
            )}
            <Text type="supporting" color="secondary">
              {units} item{units === 1 ? "" : "s"} · Order {order.id}
            </Text>
          </Stack>
          <Text type="body" weight="semibold">
            {money(grandWithFee(order), order.currencyCode)}
          </Text>
        </Stack>
      </Stack>
    </Card>
  );
}

function SkeletonList() {
  return (
    <Stack direction="vertical" gap={3} style={{ padding: "var(--spacing-2)" }}>
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <Stack direction="vertical" gap={2}>
            <Stack direction="horizontal" gap={2} hAlign="between">
              <Skeleton width={90} height={14} index={i} />
              <Skeleton width={70} height={20} radius="rounded" index={i} />
            </Stack>
            <Stack direction="horizontal" gap={2} hAlign="between">
              <Skeleton width="60%" height={16} index={i} />
              <Skeleton width={64} height={16} index={i} />
            </Stack>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

function ListOrders() {
  const { data } = useToolResult<ListOrdersOutput>();

  if (!data) return <SkeletonList />;

  const orders = Array.isArray(data.orders) ? data.orders : [];

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<Icon icon={ShoppingBagGlyph} size="lg" />}
        title="No orders yet"
        description="Orders you place will show up here."
      />
    );
  }

  return (
    <Stack direction="vertical" gap={3} style={{ padding: "var(--spacing-2)" }}>
      <Heading level={4}>Your orders</Heading>
      {orders.map((order, i) => (
        <OrderCard key={order.id ?? i} order={order} />
      ))}
    </Stack>
  );
}

createRoot(document.getElementById("root")!).render(
  <Theme theme={themes[defaultThemeSlug]}>
    <ListOrders />
  </Theme>,
);
