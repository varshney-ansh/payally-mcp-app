/**
 * Brand configuration — the single source of truth for "which brand is this
 * MCP server?".
 *
 * This MCP server is a TEMPLATE: one codebase is deployed once per merchant,
 * each instance branded for that merchant's brand. Everything brand-specific
 * comes from environment variables (collected by the PayAlly Partner portal at
 * onboarding) so the SAME build serves any brand — only the env changes.
 *
 * RULE: nothing here (or anywhere in the customer/agent-facing surface) may
 * reveal PayAlly internals. The customer and their AI agent should see ONLY the
 * brand. In particular the PayPal merchant id (`PAYPAL_MERCHANT_ID`) is the
 * BRAND's PayPal id and must NEVER be exposed to the agent or customer — it is
 * server-side only.
 */

export interface Brand {
  /** The brand's display name, e.g. "Nike". Used as the MCP server name and in
   *  tool descriptions so the agent talks about the brand, not PayAlly. */
  name: string;

  /**
   * How the brand calls its storefront, e.g. "store", "boutique", "shop".
   * Produces phrases like "the Nike store catalog" in tool descriptions.
   */
  storeNoun: string;

  /**
   * One-line brand voice/tone hint woven into tool descriptions, e.g. an
   * athletic, premium feel. Optional.
   */
  voice?: string;

  /**
   * What the brand sells, as natural nouns, e.g. "sneakers", "running shoes",
   * "handbags". Injected into tool descriptions so the agent can speak the
   * brand's product language. Optional (the live catalog is always the source
   * of truth for actual categories — see categoryHints).
   */
  productNouns?: string[];

  /**
   * Brand category hints, e.g. ["Athletic Shoes", "Running", "Training"].
   * OPTIONAL FLAVOR ONLY — these shape tool descriptions to help the agent
   * answer "what does {brand} sell?". The REAL categories always come from the
   * live catalog API, so keep this short and high-level; a long list can drift
   * from the catalog. Optional.
   */
  categoryHints?: string[];
}

/** Splits a comma/semicolon-separated env var into a trimmed string list. */
function listEnv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

/** Builds the brand config from environment variables. */
export function loadBrand(): Brand {
  const name = (process.env.BRAND_NAME ?? 'PayAlly').trim() || 'PayAlly';
  const storeNoun = (process.env.BRAND_STORE_NOUN ?? 'store').trim() || 'store';

  const brand: Brand = {
    name,
    storeNoun,
    voice: process.env.BRAND_VOICE?.trim() || undefined,
    productNouns: listEnv(process.env.BRAND_PRODUCT_NOUNS),
    categoryHints: listEnv(process.env.BRAND_CATEGORY_HINTS),
  };
  return brand;
}

/** The brand for this instance, resolved once at startup from the env. */
export const brand = loadBrand();

/* ---- Phrase helpers used by tool descriptions ------------------------- */

/** "the Nike store catalog" / "the PayAlly catalog". */
export function storePhrase(b: Brand): string {
  return `the ${b.name} ${b.storeNoun}`;
}

/**
 * A short "what they sell" phrase for use inside a sentence, e.g. "sneakers,
 * running shoes and training gear across Athletic Shoes and Running". Falls
 * back to a neutral "products" when nothing is configured.
 */
export function sellsNoun(b: Brand): string {
  if (b.productNouns?.length && b.categoryHints?.length) {
    return `${joinAnd(b.productNouns)} across ${joinAnd(b.categoryHints)}`;
  }
  if (b.productNouns?.length) return joinAnd(b.productNouns);
  if (b.categoryHints?.length) return `products across ${joinAnd(b.categoryHints)}`;
  return 'products';
}

/** Joins a list as "a, b and c". */
function joinAnd(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
