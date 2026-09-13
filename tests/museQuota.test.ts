import { describe, expect, test } from 'bun:test';
import {
  MUSE_KEY_URL,
  MUSE_REQUEST_HEADERS,
  parseMuseKeyPayload,
} from '../src/utils/quota/muse';
import { isMuseFile, resolveAuthProvider } from '../src/utils/quota/validators';
import { QUOTA_ADAPTERS } from '../src/features/quota/providers';
import { buildTimelineLane } from '../src/features/quota/quotaTimelineModel';
import en from '../src/i18n/locales/en.json';

const keyResponse = (overrides: Record<string, unknown> = {}) => ({
  api_key: 'LLM|subscription-key-that-must-never-surface',
  user_email: 'Muse@Example.com',
  user_id: 'meta-account-1',
  is_subs_active: true,
  subs_tier_id: 'high',
  subs_tier_name: 'High',
  subs_usage: {
    window: {
      used_percent: 12.5,
      resets_at: '2026-09-14T00:00:00.000Z',
      window_duration_mins: 300,
    },
    weekly: {
      used_percent: 34,
      resets_at: 1789500000,
    },
  },
  ...overrides,
});

describe('Muse quota parsing', () => {
  test('maps rolling + weekly windows with tier and email', () => {
    const parsed = parseMuseKeyPayload(keyResponse());
    expect(parsed).not.toBeNull();
    expect(parsed?.active).toBeTrue();
    expect(parsed?.tier).toBe('High');
    expect(parsed?.email).toBe('muse@example.com');
    expect(parsed?.windows.length).toBe(2);
    const rolling = parsed?.windows.find((window) => window.id === '300m');
    expect(rolling?.usedPercent).toBe(12.5);
    expect(rolling?.resetAtMs).toBe(Date.parse('2026-09-14T00:00:00.000Z'));
    expect(rolling?.periodHours).toBe(5);
    const weekly = parsed?.windows.find((window) => window.id === '1w');
    expect(weekly?.usedPercent).toBe(34);
    // Epoch seconds are normalized to milliseconds.
    expect(weekly?.resetAtMs).toBe(1789500000 * 1000);
    expect(weekly?.periodHours).toBe(24 * 7);
  });

  test('never exposes the minted api_key', () => {
    const parsed = parseMuseKeyPayload(keyResponse());
    expect(JSON.stringify(parsed)).not.toContain('LLM|');
  });

  test('rejects inactive subscriptions and unusable bodies', () => {
    const inactive = parseMuseKeyPayload(keyResponse({ is_subs_active: false }));
    expect(inactive?.active).toBeFalse();
    expect(parseMuseKeyPayload('not-json')).toBeNull();
    expect(parseMuseKeyPayload(null)).toBeNull();
    expect(parseMuseKeyPayload([])).toBeNull();
  });

  test('keeps tier and identity when Meta reports no usage windows', () => {
    // Live shape on tiers without windows: active subscription, no subs_usage.
    const { subs_usage: _dropped, ...withoutUsage } = keyResponse();
    void _dropped;
    const parsed = parseMuseKeyPayload(withoutUsage);
    expect(parsed).not.toBeNull();
    expect(parsed?.active).toBeTrue();
    expect(parsed?.tier).toBe('High');
    expect(parsed?.email).toBe('muse@example.com');
    expect(parsed?.windows).toEqual([]);
    expect(parseMuseKeyPayload(keyResponse({ subs_usage: null }))).not.toBeNull();
    expect(parseMuseKeyPayload(keyResponse({ subs_usage: {} }))?.windows).toEqual([]);
  });

  test('tolerates string numbers and missing timestamps', () => {
    const parsed = parseMuseKeyPayload(
      keyResponse({
        subs_usage: {
          window: { used_percent: '50', window_duration_mins: '60' },
          weekly: null,
        },
      })
    );
    expect(parsed?.windows.length).toBe(1);
    expect(parsed?.windows[0].usedPercent).toBe(50);
    expect(parsed?.windows[0].resetAtMs).toBeNull();
    expect(parsed?.windows[0].periodHours).toBe(1);
  });
});

describe('Muse quota wiring', () => {
  test('resolves muse files and registers the adapter', () => {
    expect(resolveAuthProvider({ name: 'm.json', type: 'muse' })).toBe('muse');
    expect(isMuseFile({ name: 'm.json', type: 'muse' } as never)).toBeTrue();
    expect(isMuseFile({ name: 'k.json', type: 'kimi' } as never)).toBeFalse();
    expect(QUOTA_ADAPTERS.muse.type).toBe('muse');
    expect(QUOTA_ADAPTERS.muse.i18nPrefix).toBe('muse_quota');
  });

  test('uses the key endpoint with version header and empty probe body', () => {
    expect(MUSE_KEY_URL).toBe('https://api.meta.ai/muse-code/key');
    expect(MUSE_REQUEST_HEADERS['x-api-version']).toBe('1.0.0');
    expect(MUSE_REQUEST_HEADERS.Authorization).toContain('$TOKEN$');
  });

  test('provides muse_quota translations', () => {    const authLogin = (
      en as unknown as Record<string, Record<string, string>>
    ).muse_quota;
    for (const key of [
      'title',
      'refresh_button',
      'empty_data',
      'no_windows',
      'weekly',
      'rolling_window_hours',
      'subscription_tier',
      'rate_limited',
      'inactive_subscription',
    ]) {
      expect(authLogin[key]?.length).toBeGreaterThan(0);
    }
  });
});

describe('Muse timeline lane', () => {
  test('renders translated, unique limit labels', () => {
    const lane = buildTimelineLane({
      name: 'muse.json',
      displayName: 'muse@example.com',
      provider: 'muse',
      quota: {
        status: 'success',
        rows: [
          {
            id: '300m',
            label: 'Rolling window (5h)',
            labelKey: 'muse_quota.rolling_window_hours',
            used: 12.5,
            limit: 100,
            resetAtMs: Date.now() + 3600_000,
            periodHours: 5,
          },
          {
            id: '1w',
            label: 'Weekly',
            labelKey: 'muse_quota.weekly',
            used: 34,
            limit: 100,
            resetAtMs: Date.now() + 86400_000,
            periodHours: 168,
          },
        ],
      },
    });
    expect(lane.limits.length).toBe(2);
    const labels = lane.limits.map((limit) => limit.label);
    expect(labels.every((label) => label.trim().length > 0)).toBeTrue();
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('Muse quota page wiring', () => {
  test('every quota tab type resolves to an adapter slice that exists', async () => {
    const { QUOTA_TAB_ORDER } = await import('../src/features/quota/constants');
    const { useQuotaStore } = await import('../src/stores/useQuotaStore');
    const state = useQuotaStore.getState();
    for (const type of QUOTA_TAB_ORDER) {
      const adapter = QUOTA_ADAPTERS[type];
      expect(adapter).toBeDefined();
      // Mirrors QuotaPage quotaByType: selector slice must exist or the page
      // crashes reading [file.name] off undefined.
      const slice = adapter.storeSelector(state as never) as unknown;
      expect(slice).toBeDefined();
      expect(typeof state[adapter.storeSetter]).toBe('function');
    }
    expect(QUOTA_TAB_ORDER).toContain('muse');
  });
});

describe('Muse empty-payload guard', () => {
  test('degenerate bodies without windows or identity still error', async () => {
    const { parseMuseKeyPayload } = await import('../src/utils/quota/muse');
    expect(parseMuseKeyPayload({})).toBeNull();
    expect(parseMuseKeyPayload({ is_subs_active: true })).toBeNull();
    expect(parseMuseKeyPayload({ subs_usage: null })).toBeNull();
  });
});
