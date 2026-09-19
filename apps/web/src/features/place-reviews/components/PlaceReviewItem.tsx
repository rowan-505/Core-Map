import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { ReportEntryButton } from '@/features/reports/components/ReportEntryButton';
import type { ReportTypeCode } from '@/features/reports/api/reportsApi';
import type { PlaceReviewPublic } from '../api/placeReviewsApiTypes';

type PlaceReviewItemProps = {
  readonly review: PlaceReviewPublic;
};

const REVIEW_REPORT_CODES = [
  'tourism_incorrect_review',
  'tourism_other',
] as const satisfies readonly ReportTypeCode[];

export function PlaceReviewItem({ review }: PlaceReviewItemProps) {
  const t = useMapUiText();
  return (
    <article className="rounded-map-card border border-map-border/70 bg-map-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-map-ink">
          {review.author.display_name}
        </p>
        <p className="shrink-0 text-xs font-semibold tabular-nums text-map-primary">
          {t(`အဆင့် ${review.rating}`, `${review.rating}/5`)}
        </p>
      </div>
      {review.title ? (
        <p className="mt-1.5 text-sm font-semibold leading-5 text-map-ink">{review.title}</p>
      ) : null}
      {review.body ? <p className="mt-1 text-sm leading-5 text-map-muted">{review.body}</p> : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] tabular-nums text-map-muted/80">
          {formatReviewDate(review.published_at ?? review.created_at)}
        </p>
        <ReportEntryButton
          label={t('တိုင်ကြား', 'Report')}
          className="inline-flex min-h-9 items-center gap-1 rounded-map-control border border-map-border bg-map-bg px-2.5 text-[11px] font-semibold text-map-muted hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary"
          target={{
            targetEntityType: 'tourism_review',
            targetPublicId: review.public_id,
            contextLabel: review.title?.trim() || t('သုံးသပ်ချက်', 'Review'),
            allowedTypeCodes: REVIEW_REPORT_CODES,
            defaultTypeCode: 'tourism_incorrect_review',
          }}
        />
      </div>
    </article>
  );
}

function formatReviewDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
