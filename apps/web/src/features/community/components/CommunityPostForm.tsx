import { useState } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import {
  COMMUNITY_CATEGORIES,
  type CommunityCategoryCode,
} from '../lib/communityCategories';
import type { CommunityLocation } from '../api/communityApi';

export type CommunityPostFormValues = {
  readonly title: string;
  readonly description: string;
  readonly category: CommunityCategoryCode;
  readonly includeLocation: boolean;
};

type CommunityPostFormProps = {
  readonly initial?: Partial<CommunityPostFormValues>;
  readonly defaultLocation: CommunityLocation | null;
  readonly submitLabel: string;
  readonly pending?: boolean;
  readonly errorMessage?: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (values: CommunityPostFormValues) => void;
};

export function CommunityPostForm({
  initial,
  defaultLocation,
  submitLabel,
  pending = false,
  errorMessage = null,
  onCancel,
  onSubmit,
}: CommunityPostFormProps) {
  const t = useMapUiText();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<CommunityCategoryCode>(
    initial?.category ?? 'local_update',
  );
  const [includeLocation, setIncludeLocation] = useState(
    initial?.includeLocation ?? Boolean(defaultLocation),
  );

  return (
    <form
      className="space-y-3 p-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          title: title.trim(),
          description: description.trim(),
          category,
          includeLocation,
        });
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-map-muted">{t('ခေါင်းစဉ်', 'Title')}</span>
        <input
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm text-map-ink outline-none focus:border-map-primary/40 focus:ring-2 focus:ring-map-primary/15"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-semibold text-map-muted">
          {t('အမျိုးအစား', 'Category')}
        </span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CommunityCategoryCode)}
          className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm text-map-ink outline-none focus:border-map-primary/40 focus:ring-2 focus:ring-map-primary/15"
        >
          {COMMUNITY_CATEGORIES.map((item) => (
            <option key={item.code} value={item.code}>
              {t(item.labelMy, item.labelEn)}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-semibold text-map-muted">
          {t('အကြောင်းအရာ', 'Description')}
        </span>
        <textarea
          required
          maxLength={5000}
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full resize-y rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm leading-6 text-map-ink outline-none focus:border-map-primary/40 focus:ring-2 focus:ring-map-primary/15"
        />
      </label>

      <label className="flex items-start gap-2 rounded-map-card border border-map-border/80 bg-map-primary-soft/40 px-3 py-2.5">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={includeLocation}
          disabled={!defaultLocation}
          onChange={(e) => setIncludeLocation(e.target.checked)}
        />
        <span className="text-sm leading-5 text-map-ink">
          {t('မြေပုံပေါ် တည်နေရာ ထည့်ရန်', 'Pin this post on the map')}
          <span className="mt-0.5 block text-xs text-map-muted">
            {defaultLocation
              ? defaultLocation.label ??
                `${defaultLocation.lat.toFixed(5)}, ${defaultLocation.lng.toFixed(5)}`
              : t(
                  'မြေပုံကို နှိပ်၍ တည်နေရာ ရွေးပါ။',
                  'Click the map to choose a location first.',
                )}
          </span>
        </span>
      </label>

      {errorMessage ? (
        <p className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="flex-1 rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm font-semibold text-map-muted hover:bg-map-primary-soft hover:text-map-primary"
          onClick={onCancel}
          disabled={pending}
        >
          {t('ပယ်ဖျက်', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={pending || title.trim() === '' || description.trim() === ''}
          className="flex-1 rounded-map-control bg-map-primary px-3 py-2 text-sm font-semibold text-white shadow-map-control disabled:opacity-50"
        >
          {pending ? t('သိမ်းနေသည်…', 'Saving…') : submitLabel}
        </button>
      </div>
    </form>
  );
}
