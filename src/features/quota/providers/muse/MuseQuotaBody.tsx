/**
 * Muse 额度渲染体：用量行水位条 + 订阅档位。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MuseQuotaState } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function MuseQuotaBody({ quota, classes }: QuotaBodyProps<MuseQuotaState>) {
  const { t, i18n } = useTranslation();
  // Ahead of the early return below — hooks cannot be conditional.
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('muse', quota), now),
    [quota, now]
  );
  const rows = quota.rows ?? [];

  if (rows.length === 0) {
    // Meta omits usage windows for some active subscriptions: show what is
    // known (tier) plus an explanatory note instead of an error state.
    return (
      <>
        {quota.tier && (
          <div className={classes.quotaMessage}>
            {t('muse_quota.subscription_tier', { tier: quota.tier })}
          </div>
        )}
        <div className={classes.quotaMessage}>{t('muse_quota.no_windows')}</div>
      </>
    );
  }

  return (
    <>
      {quota.tier && (
        <div className={classes.quotaMessage}>
          {t('muse_quota.subscription_tier', { tier: quota.tier })}
        </div>
      )}
      {rows.map((row, index) => {
        const remaining = Math.max(0, Math.min(100, Math.round(row.limit - row.used)));
        const percentLabel = `${remaining}%`;
        const resetDisplay = buildResetDisplay(
          null,
          row.resetAtMs ?? null,
          now,
          i18n.resolvedLanguage
        );
        const soon = row.id === soonestRowId;

        return (
          <div
            key={row.id}
            className={classes.quotaRow}
            title={soon ? t('quota_management.soonest_row_hint') : undefined}
          >
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>
                {t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)}
              </span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>{percentLabel}</span>
                {resetDisplay && (
                  <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                )}
              </div>
            </div>
            <QuotaMeter percent={remaining} classes={classes} index={index} />
          </div>
        );
      })}
    </>
  );
}
