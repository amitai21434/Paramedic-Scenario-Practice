// Unit handling for drug doses: "mg", "mcg/kg/min", "J", …

const MASS: Record<string, number> = { g: 1000, mg: 1, mcg: 0.001 };

export function splitUnit(unit: string) {
  const parts = unit.split("/");
  return { base: parts[0] || "", perKg: parts.includes("kg"), perMin: parts.includes("min") };
}

/** Converts a dose between units (mass and per-kg aware). null when they can't be compared (mg vs ml, dose vs rate). */
export function convert(value: number, from: string, to: string, weight: number): number | null {
  const a = splitUnit(from);
  const b = splitUnit(to);
  if (a.perMin !== b.perMin) return null;
  let v = value;
  if (a.base !== b.base) {
    if (!(a.base in MASS) || !(b.base in MASS)) return null;
    v = (v * MASS[a.base]) / MASS[b.base];
  }
  if (a.perKg && !b.perKg) v *= weight;
  if (!a.perKg && b.perKg) v /= weight;
  return Math.round(v * 1000) / 1000;
}

const UNIT_LABELS: Record<string, string> = { mcg: "mcg", mg: "mg", g: "g", ml: "ml", iu: "IU", meq: "mEq", J: "J" };

export function unitLabel(unit: string | null): string {
  if (!unit) return "";
  return unit
    .split("/")
    .map((p) => UNIT_LABELS[p] ?? p)
    .join("/");
}
