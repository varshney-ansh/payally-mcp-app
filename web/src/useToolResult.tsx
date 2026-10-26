import { useState } from "react";
import {
  useApp,
  useHostStyles,
  type App,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/react";

/**
 * Hydrates a read-only widget from the MCP Apps tool-result notification.
 *
 * Registers the `toolresult` listener inside `onAppCreated` (before the
 * connect handshake completes) so no notification is missed, and also seeds
 * from the initial host context if a structured result is already present.
 *
 * The returned `data` is UNTRUSTED host input — callers must guard every
 * field before rendering.
 */
export function useToolResult<T>(): { data: T | null; isConnected: boolean } {
  const [data, setData] = useState<T | null>(null);

  const { app, isConnected } = useApp({
    appInfo: { name: "payally-widget", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (created: App) => {
      // Register before connect so the one-shot tool result is not missed.
      created.addEventListener("toolresult", (params) => {
        setData((params?.structuredContent ?? null) as T | null);
      });

      // Seed from the initial host context if a result rode along with it.
      const seeded = extractStructuredContent(created.getHostContext());
      if (seeded != null) {
        setData(seeded as T);
      }
    },
  });

  // Keep host theme / style variables in sync, applying the initial context
  // immediately on mount.
  useHostStyles(app, app?.getHostContext());

  return { data, isConnected };
}

/**
 * Best-effort pull of a structured result from the initial host context.
 *
 * `toolInfo` carries the tool definition; some hosts additionally attach the
 * result's `structuredContent`. We read it defensively and return null when
 * absent (the common case — the `toolresult` event is the primary source).
 */
function extractStructuredContent(ctx: McpUiHostContext | undefined): unknown {
  if (!ctx) return null;
  const toolInfo = ctx.toolInfo as { structuredContent?: unknown } | undefined;
  if (toolInfo && toolInfo.structuredContent != null) {
    return toolInfo.structuredContent;
  }
  return null;
}
