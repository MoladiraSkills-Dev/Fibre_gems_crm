// Shared Agility CSV parsing helpers (day-first dates, name keys, order refs).

export function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Extracts OVR-…/OVK-… from an Agility description like
// 'Vumatel Key - (OVK-010426-03126152) - Re-Order Attempt: 2'
export function extractOrderRef(text: string): string | null {
  const m = (text || "").match(/OV[RK][-\s]?\d{6}[-\s]?\d+/i);
  if (!m) return null;
  return m[0].toUpperCase().replace(/\s+/g, "");
}

// Parses 'DD/MM/YYYY HH:MM:SS' (day-first) into a UTC Date.
export function parseAgilityDate(value: string): Date | null {
  const m = (value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const d = m[1]!;
  const mo = m[2]!;
  const y = m[3]!;
  const h = m[4] ?? "0";
  const mi = m[5] ?? "0";
  const s = m[6] ?? "0";
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function parsePremiseId(value: string): number | null {
  const n = Number.parseInt((value || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// Normalizes SA phone numbers to '27…' digits-only form.
// Handles 9-digit local ('713036121' → '27713036121'),
// '0…' local, dirty trailing chars, and rejects emails.
export function normalizePhone(value: string): string | null {
  const raw = (value || "").trim();
  if (!raw || raw.includes("@")) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  // Excel scientific notation artifacts on long digit strings — bail if absurd
  if (d.length > 11) return null;
  if (d.length === 9) d = `27${d}`;
  else if (d.length === 10 && d.startsWith("0")) d = `27${d.slice(1)}`;
  if (!d.startsWith("27") || d.length < 11) return null;
  return d;
}

/** Loose phone-match key for cross-source comparison (call logs vs Agility).
 * Returns digits-only '27…' form, or null when unusable. */
export function phoneMatchKey(value: string | null | undefined): string | null {
  if (!value) return null;
  let d = value.replace(/\D/g, "");
  if (!d || d.includes("@")) return null;
  if (d.length === 9) d = `27${d}`;
  else if (d.length === 10 && d.startsWith("0")) d = `27${d.slice(1)}`;
  return d.length >= 11 ? d : null;
}
