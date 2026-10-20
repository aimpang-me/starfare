// Rounding for what people read. Stored scores, tool results, /board.json and bench traces keep exact values;
// pages show whole points (34,994, not 34993.98485825111).

/** A score in whole points (no -0). Anything that is not a number passes through. */
export const points = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) || 0 : n);

/** Whole points with thousands separators, for pages. */
export const pointsText = (n) => (typeof n === "number" && Number.isFinite(n) ? points(n).toLocaleString("en-US") : String(n));

/** Binary float noise in text the engine writes (678.0999999999999 kg -> 678.1 kg). Twelve significant digits keep every
 *  digit the engine means; only runs of nine or more decimals are touched. */
export const tidyText = (s) => s.replace(/\d+\.\d{9,}/g, (m) => String(+(+m).toPrecision(12)));
