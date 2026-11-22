// Cost report prices: per material a price per kg and a cutting cost per minute, a fixed cost and the
// currency. Shared on the server like the stock and the rules (an admin changes them; the others can change
// them for one report); the browser keeps a copy (and is all there is in the demo). A material's price is
// found whatever its spelling ("S355" and "s355 " are the same material).

export interface MaterialPrice { kg: number; min: number }
export interface CostPrices { currency: string; materials: Record<string, MaterialPrice>; fixed: number }

const KEY = "gnezdo.costPrices";
export const DEFAULT_COST_PRICES: CostPrices = { currency: "€", materials: {}, fixed: 0 };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** Checked and filled up with the defaults; null when it is not prices at all. */
export function normalizeCostPrices(v: unknown): CostPrices | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Partial<Record<keyof CostPrices, unknown>>;
  const materials: Record<string, MaterialPrice> = {};
  if (o.materials && typeof o.materials === "object" && !Array.isArray(o.materials))
    for (const [m, p] of Object.entries(o.materials as Record<string, unknown>)) {
      if (!m.trim() || !p || typeof p !== "object") continue;
      const x = p as Partial<Record<keyof MaterialPrice, unknown>>;
      materials[m] = { kg: num(x.kg), min: num(x.min) };
    }
  return { currency: typeof o.currency === "string" ? o.currency.slice(0, 10) : DEFAULT_COST_PRICES.currency, materials, fixed: num(o.fixed) };
}

export function loadCostPrices(): CostPrices {
  try { return normalizeCostPrices(JSON.parse(localStorage.getItem(KEY) ?? "null")) ?? DEFAULT_COST_PRICES; }
  catch { return DEFAULT_COST_PRICES; }
}

export function saveCostPrices(p: CostPrices): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* not kept */ }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The key the material's price is kept under (its first spelling), if it has one. */
const keyOf = (p: CostPrices, material: string) =>
  material in p.materials ? material : Object.keys(p.materials).find((k) => same(k, material));

/** The material's price (any spelling); undefined: none set. */
export function priceFor(p: CostPrices, material: string): MaterialPrice | undefined {
  const k = keyOf(p, material);
  return k === undefined ? undefined : p.materials[k];
}

/** The prices with the material's changed (kept under the spelling it already has). */
export function withPrice(p: CostPrices, material: string, patch: Partial<MaterialPrice>): CostPrices {
  const k = keyOf(p, material) ?? material.trim();
  return { ...p, materials: { ...p.materials, [k]: { ...(p.materials[k] ?? { kg: 0, min: 0 }), ...patch } } };
}
