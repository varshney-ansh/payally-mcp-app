import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { listOrders, getOrderById } from '../payally-api.js';
import { resolveUserEmail, type AuthConfig } from './auth.js';
import { readWidgetHtml } from './widget-html.js';
import { brand, storePhrase } from '../brand.js';

/**
 * Order-history tools — MCP Apps tools with inline Astryx widgets that show the
 * signed-in user their past orders. Both resolve the buyer's email from their
 * Auth0 profile (never a tool arg) and use the env merchant id, then POST to
 * the PayAlly order endpoints. The endpoint's JSON response is returned as the
 * tool result (model-visible `content`) AND fed to the widget (structuredContent).
 *
 *   list-my-orders     -> POST v1/show-orders        { merchantId, email }  -> { orders: [...] }
 *   get-order-details  -> POST v1/show-order-by-id   { merchantId, email, orderId } -> { order }
 */

const LIST_WIDGET_URI = 'ui://widget/list-orders.html';
const DETAIL_WIDGET_URI = 'ui://widget/order-detail.html';

/**
 * Strips the brand's PayPal merchant id from an order object so it is never
 * exposed to the agent/customer. The user's own email fields are kept (they
 * know their own email). Returns a shallow copy; safe on any shape.
 */
function scrubOrder(order: unknown): unknown {
  if (order && typeof order === 'object' && !Array.isArray(order)) {
    const { paypalMerchantId: _omit, ...rest } = order as Record<string, unknown>;
    return rest;
  }
  return order;
}

/** Applies scrubOrder to each order in an order-history / order-detail response. */
function scrubOrderResponse(response: unknown): unknown {
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>;
    if (Array.isArray(r.orders)) {
      return { ...r, orders: r.orders.map(scrubOrder) };
    }
    if (r.order && typeof r.order === 'object') {
      return { ...r, order: scrubOrder(r.order) };
    }
  }
  return scrubOrder(response);
}

function fail(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}

/** The endpoint response is both the model-visible content and the widget data. */
function ok(response: unknown) {
  const structured =
    response && typeof response === 'object'
      ? (response as Record<string, unknown>)
      : { response };
  return {
    structuredContent: structured,
    content: [{ type: 'text' as const, text: JSON.stringify(response) }],
  };
}

export function registerOrderTools(server: McpServer, merchantIdFallback: string, auth: AuthConfig) {
  // ---- Widget resources (no external images/API; minimal CSP) ------------
  registerAppResource(
    server,
    'list-orders-widget',
    LIST_WIDGET_URI,
    { description: `A list of the buyer's past ${brand.name} orders with status and totals.` },
    async () => ({
      contents: [
        {
          uri: LIST_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readWidgetHtml('list-orders.js'),
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    }),
  );

  registerAppResource(
    server,
    'order-detail-widget',
    DETAIL_WIDGET_URI,
    { description: 'A single order with its line items and payment totals.' },
    async () => ({
      contents: [
        {
          uri: DETAIL_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readWidgetHtml('order-detail.js'),
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    }),
  );

  // 1) LIST MY ORDERS -------------------------------------------------------
  registerAppTool(
    server,
    'list-my-orders',
    {
      title: 'Show my orders',
      description:
        `Show the orders the signed-in user has placed with ${storePhrase(brand)} — date, status and total for each. Use when the user asks about their order history or recent purchases. The buyer is always the signed-in user; takes no arguments.`,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: {
        ui: { resourceUri: LIST_WIDGET_URI },
        'openai/toolInvocation/invoking': 'Fetching your orders…',
        'openai/toolInvocation/invoked': 'Orders ready',
      },
    },
    async (_args, ctx) => {
      try {
        const email = await resolveUserEmail(ctx, auth);
        const response = await listOrders({ merchantId: merchantIdFallback, email });
        return ok(scrubOrderResponse(response));
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Failed to list orders.');
      }
    },
  );

  // 2) GET ORDER DETAILS ----------------------------------------------------
  registerAppTool(
    server,
    'get-order-details',
    {
      title: 'Show order details',
      description:
        `Show one of the signed-in user's ${brand.name} orders in full — items, quantities, prices and totals — from its order id. Use when the user asks about a specific order. Get the order id from the order-history tool.`,
      inputSchema: z.object({
        orderId: z.string().min(1).describe('The order id (from the order-history list) to look up.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: {
        ui: { resourceUri: DETAIL_WIDGET_URI },
        'openai/toolInvocation/invoking': 'Fetching order…',
        'openai/toolInvocation/invoked': 'Order ready',
      },
    },
    async ({ orderId }, ctx) => {
      try {
        const email = await resolveUserEmail(ctx, auth);
        const response = await getOrderById({ merchantId: merchantIdFallback, email, orderId });
        return ok(scrubOrderResponse(response));
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Failed to get order details.');
      }
    },
  );
}
