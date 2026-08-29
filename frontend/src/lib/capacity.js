/**
 * Parse a human-typed capacity string into MB (integer).
 *
 * Accepted formats (case-insensitive, comma/period both fine as decimal sep):
 *   "500"      → 500 MB (bare number → default GB for backward compat when
 *                        `defaultUnit` = "gb", or MB when "mb")
 *   "500 MB"   → 500
 *   "500M"     → 500
 *   "1.5 GB"   → 1536
 *   "10G"      → 10240
 *   "2 TB"     → 2097152
 *
 * Returns the MB value as an integer, or `null` if the input is empty/invalid
 * / non-positive. The `0` string is treated as "clear" and returns 0
 * explicitly so callers can distinguish "clear override" from "invalid".
 */
export function parseCapacityToMb(input, defaultUnit = "gb") {
  if (input == null) return null;
  const raw = String(input).replace(",", ".").trim().toLowerCase();
  if (raw === "") return null;
  if (raw === "0") return 0;
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(mb|m|gb|g|tb|t)?$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = m[2] || defaultUnit;
  let mb;
  if (unit === "mb" || unit === "m") mb = num;
  else if (unit === "gb" || unit === "g") mb = num * 1024;
  else if (unit === "tb" || unit === "t") mb = num * 1024 * 1024;
  else return null;
  return Math.round(mb);
}

/**
 * Format an MB value to the shortest sensible human string.
 *   0-999   → "500 MB"
 *   1024+   → "1.5 GB" (drop trailing zero for whole GB → "1 GB")
 *   1TB+    → "2 TB"
 */
export function formatMb(mb) {
  if (mb == null || !Number.isFinite(mb) || mb <= 0) return "";
  if (mb >= 1024 * 1024) {
    const tb = mb / (1024 * 1024);
    return `${Number.isInteger(tb) ? tb : tb.toFixed(2)} TB`;
  }
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(2)} GB`;
  }
  return `${Math.round(mb)} MB`;
}
