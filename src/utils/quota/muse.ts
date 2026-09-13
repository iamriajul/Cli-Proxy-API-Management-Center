/**
 * Muse (Meta muse-spark subscription) quota helpers. React-free.
 *
 * The subscription key endpoint doubles as the usage endpoint: it returns the
 * minted api_key plus subs_usage windows. Only percent/identity/window fields
 * are kept — the api_key itself is never stored or rendered.
 */

export const MUSE_KEY_URL = 'https://api.meta.ai/muse-code/key';

export const MUSE_REQUEST_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: 'Bearer $TOKEN$',
  'x-api-version': '1.0.0',
};

export interface MuseUsageWindow {
  used_percent?: number | string | null;
  resets_at?: string | number | null;
  window_duration_mins?: number | string | null;
}

export interface MuseKeyPayload {
  api_key?: string;
  user_email?: string | null;
  user_id?: string | null;
  is_subs_active?: boolean | null;
  subs_tier_id?: string | null;
  subs_tier_name?: string | null;
  subs_usage?: {
    window?: MuseUsageWindow | null;
    weekly?: MuseUsageWindow | null;
  } | null;
}

export interface MuseQuotaWindow {
  id: string;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  usedPercent: number;
  resetAtMs: number | null;
  periodHours: number | null;
}

export interface MuseQuotaData {
  active: boolean;
  tier?: string;
  email?: string;
  windows: MuseQuotaWindow[];
}

const toFiniteNumber = (value: unknown): number | null => {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : null;
};

const parseResetMs = (value: unknown): number | null => {
  if (typeof value === 'string') {
    const ms = Date.parse(value.trim());
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Meta emits seconds or milliseconds; disambiguate by magnitude.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  return null;
};

const formatRollingLabel = (
  minutes: number | null
): { labelKey: string; labelParams?: Record<string, string | number> } => {
  if (minutes === null || minutes <= 0) return { labelKey: 'muse_quota.rolling_window' };
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return {
      labelKey: 'muse_quota.rolling_window_hours',
      labelParams: { count: hours },
    };
  }
  return {
    labelKey: 'muse_quota.rolling_window_minutes',
    labelParams: { count: Math.round(minutes) },
  };
};

const toWindow = (
  id: string,
  label: { labelKey: string; labelParams?: Record<string, string | number> },
  raw: MuseUsageWindow | null | undefined
): MuseQuotaWindow | null => {
  if (!raw || typeof raw !== 'object') return null;
  const usedPercent = toFiniteNumber(raw.used_percent);
  if (usedPercent === null || usedPercent < 0) return null;
  const minutes = toFiniteNumber(raw.window_duration_mins);
  return {
    id,
    ...label,
    usedPercent: Math.min(usedPercent, 100),
    resetAtMs: parseResetMs(raw.resets_at),
    periodHours:
      minutes !== null && minutes > 0 ? Math.round((minutes / 60) * 100) / 100 : null,
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Parse the key-endpoint JSON into quota data. Null only when unusable.
 *
 * Meta does not always report usage windows: active subscriptions (observed
 * on the Everyday Usage tier) can return tier and identity with no
 * subs_usage at all. That still parses — with zero windows — so the panel
 * shows what is known instead of erroring.
 */
export function parseMuseKeyPayload(payload: unknown): MuseQuotaData | null {
  const root = asRecord(payload);
  if (!root) return null;
  const usage = asRecord(root.subs_usage);
  const windows: MuseQuotaWindow[] = [];
  if (usage) {
    const rollingRaw = asRecord(usage.window) as MuseUsageWindow | null;
    const rollingMinutes = toFiniteNumber(rollingRaw?.window_duration_mins);
    const rolling = toWindow(
      rollingMinutes !== null && rollingMinutes > 0 ? `${Math.round(rollingMinutes)}m` : 'rolling',
      formatRollingLabel(rollingMinutes),
      rollingRaw
    );
    if (rolling) windows.push(rolling);
    const weekly = toWindow(
      '1w',
      { labelKey: 'muse_quota.weekly' },
      asRecord(usage.weekly) as MuseUsageWindow | null
    );
    if (weekly) {
      weekly.periodHours = 24 * 7;
      windows.push(weekly);
    }
  }
  // No windows is not a failure: Meta omits subs_usage entirely for some
  // active subscriptions, and the tier/identity below is still worth showing.
  const tierRaw = root.subs_tier_name ?? root.subs_tier_id;
  const emailRaw = root.user_email;
  const tier =
    typeof tierRaw === 'string' && tierRaw.trim() ? tierRaw.trim() : undefined;
  const email =
    typeof emailRaw === 'string' && emailRaw.trim()
      ? emailRaw.trim().toLowerCase()
      : undefined;
  // A body with no windows and no identity is degenerate (e.g. an empty
  // object), not a windowless subscription — keep erroring on those.
  if (windows.length === 0 && tier === undefined && email === undefined) return null;
  return {
    active: root.is_subs_active !== false,
    tier,
    email,
    windows,
  };
}
