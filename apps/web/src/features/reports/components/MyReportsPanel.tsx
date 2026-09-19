import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/state/useAuth';
import { ApiError } from '@/features/auth/api/http';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { ListSkeleton, PanelEmptyState } from '@/components/ui/sidebarUi';
import {
  getMyReport,
  listMyReports,
  replyToReport,
  type MyReport,
} from '../api/reportsApi';

const STATUS_BADGE: Record<string, string> = {
  submitted: 'bg-map-primary-soft text-map-primary ring-map-primary/15',
  in_review: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  needs_more_info: 'bg-amber-50 text-amber-700 ring-amber-100',
  accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  rejected: 'bg-red-50 text-red-700 ring-red-100',
  duplicate: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
};

const TARGET_LABELS: Record<string, string> = {
  place: 'Place',
  street: 'Street',
  building: 'Building',
  bus_stop: 'Bus stop',
  bus_route: 'Bus route',
  map_point: 'Map point',
};

const TARGET_LABELS_MY: Record<string, string> = {
  place: 'နေရာ',
  street: 'လမ်း',
  building: 'အဆောက်အအုံ',
  bus_stop: 'ဘတ်စ်မှတ်တိုင်',
  bus_route: 'ဘတ်စ်လမ်းကြောင်း',
  map_point: 'မြေပုံအမှတ်',
};

const STATUS_LABELS_MY: Record<string, string> = {
  submitted: 'ပို့ပြီး',
  in_review: 'စစ်ဆေးနေသည်',
  needs_more_info: 'အချက်အလက်လိုသည်',
  accepted: 'လက်ခံပြီး',
  rejected: 'ပယ်ချပြီး',
  duplicate: 'ထပ်နေသည်',
};

const REPORT_TYPE_LABELS_MY: Record<string, string> = {
  wrong_info: 'အချက်အလက်မှား',
  wrong_location: 'တည်နေရာမှား',
  missing_item: 'နေရာပျောက်နေသည်',
  closed_or_removed: 'ပိတ်ထား သို့မဟုတ် ဖယ်ရှားပြီး',
  duplicate_item: 'နေရာထပ်နေသည်',
  transport_issue: 'အများသုံးယာဉ် ပြဿနာ',
  community_info: 'ဒေသဆိုင်ရာ အချက်အလက်',
  other_map_issue: 'အခြား မြေပုံပြဿနာ',
};

/**
 * Signed-in user's own reports. Shows type, status, target, date, and reward
 * status. When a report needs more info, the admin's question and a reply box
 * are shown inline (owner-only; anonymous reports are never listed here).
 */
export function MyReportsPanel() {
  const t = useMapUiText();
  const { isAuthenticated, openAuthModal } = useAuth();

  const query = useQuery({
    queryKey: ['my-reports'],
    queryFn: ({ signal }) => listMyReports(signal),
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) {
    return (
      <PanelEmptyState
        title={t('တိုင်ကြားချက်များ', 'Track your reports')}
        body={t('သင့်တိုင်ကြားချက်များကို ကြည့်ရန် အကောင့်ဝင်ပါ။', 'Sign in to view your reports.')}
        action={
          <button
            type="button"
            className="rounded-map-control bg-map-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-map-primary-hover"
            onClick={() => openAuthModal('login')}
          >
            {t('အကောင့်ဝင်ရန်', 'Sign in')}
          </button>
        }
      />
    );
  }

  if (query.isLoading) {
    return <ListSkeleton rows={4} />;
  }

  if (query.isError) {
    return (
      <PanelEmptyState
        tone="error"
        title={t('တိုင်ကြားချက်များ မရရှိနိုင်ပါ။', 'Reports unavailable.')}
      />
    );
  }

  const items = query.data ?? [];

  if (items.length === 0) {
    return (
      <PanelEmptyState
        title={t('တိုင်ကြားချက် မရှိသေးပါ', 'No reports yet')}
        body={t('နေရာတစ်ခုရွေးပြီး “တိုင်ကြား” ကို နှိပ်ပါ။', 'Select “Report” on any place or map point.')}
      />
    );
  }

  return (
    <section className="space-y-2 p-3.5" aria-label={t('ကျွန်ုပ်၏ တိုင်ကြားချက်များ', 'My reports')}>
      {items.map((report) => (
        <MyReportCard key={report.public_id} report={report} />
      ))}
    </section>
  );
}

function MyReportCard({ report }: { readonly report: MyReport }) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((state) => state.languageMode);
  const needsInfo = report.status.code === 'needs_more_info';
  const reportTypeLabel =
    languageMode === 'en'
      ? report.report_type.name
      : REPORT_TYPE_LABELS_MY[report.report_type.code] ?? report.report_type.name;
  const statusLabel =
    languageMode === 'en'
      ? report.status.name
      : STATUS_LABELS_MY[report.status.code] ?? report.status.name;

  return (
    <div className="rounded-map-card border border-map-border bg-map-surface p-3.5 shadow-map-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-map-ink">
            {reportTypeLabel}
          </p>
          {targetLabel(report, languageMode) ? (
            <p className="mt-0.5 truncate text-xs text-map-muted">{targetLabel(report, languageMode)}</p>
          ) : null}
          <p className="mt-0.5 text-xs text-map-muted/75">{formatDate(report.created_at, languageMode)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge code={report.status.code} label={statusLabel} />
          {report.reward_granted_at ? (
            <span className="inline-flex rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
              {t('အမှတ်ရပြီး', 'Rewarded')}
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-map-muted">
        {report.description}
      </p>

      {needsInfo ? <NeedsInfoSection publicId={report.public_id} /> : null}
    </div>
  );
}

/** Loads follow-ups for a report awaiting the owner's reply and renders the reply form. */
function NeedsInfoSection({ publicId }: { readonly publicId: string }) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((state) => state.languageMode);
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');

  const detail = useQuery({
    queryKey: ['report', publicId],
    queryFn: ({ signal }) => getMyReport(publicId, signal),
  });

  const mutation = useMutation({
    mutationFn: (message: string) => replyToReport(publicId, message),
    onSuccess: () => {
      setReply('');
      void queryClient.invalidateQueries({ queryKey: ['my-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['report', publicId] });
    },
  });

  const followups = detail.data?.followups ?? [];
  const latestAdminQuestion = [...followups]
    .reverse()
    .find((f) => f.actor_type === 'admin');

  const trimmed = reply.trim();
  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? t('စာပြန်ပို့၍ မရပါ။ ထပ်ကြိုးစားပါ။', 'Could not send your reply. Try again.')
        : null;

  return (
    <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
      <p className="map-kicker text-amber-700">
        {t('အချက်အလက် ထပ်လိုပါသည်', 'The team needs more info')}
      </p>

      {detail.isLoading ? (
        <p className="mt-1.5 text-xs text-map-muted">{t('မေးခွန်း ဖွင့်နေသည်…', 'Loading the question…')}</p>
      ) : latestAdminQuestion ? (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-5 text-map-ink">
          {latestAdminQuestion.message}
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-map-ink/80">
          {t('အတိုချုံး ပြန်ဖြေပါ။', 'Add a short reply.')}
        </p>
      )}

      {followups.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5 border-t border-amber-100 pt-2.5">
          {followups.map((f, i) => (
            <li key={`${f.created_at}-${i}`} className="text-xs">
              <span className="font-semibold text-map-ink/80">
                {f.actor_type === 'admin' ? t('CoreMap အဖွဲ့', 'Team') : t('သင်', 'You')}
              </span>
              <span className="text-map-muted/75"> · {formatDate(f.created_at, languageMode)}</span>
              <p className="mt-0.5 whitespace-pre-wrap leading-5 text-map-muted">{f.message}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2.5">
        <textarea
          className="w-full resize-none rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm text-map-ink outline-none transition-colors focus:border-map-primary "
          rows={3}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t('စာပြန်ရေးရန်…', 'Reply to the team…')}
          disabled={mutation.isPending}
        />
        {errorMessage ? (
          <p className="mt-1 text-xs font-medium text-red-700" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <button
          type="button"
          className="mt-2 w-full rounded-map-control bg-map-primary px-4 py-2 text-sm font-semibold text-white shadow-map-control transition-colors hover:bg-map-primary-hover disabled:opacity-60"
          disabled={mutation.isPending || trimmed.length === 0}
          onClick={() => mutation.mutate(trimmed)}
        >
          {mutation.isPending ? t('ပို့နေသည်…', 'Sending…') : t('စာပြန်ပို့ရန်', 'Send reply')}
        </button>
        <p className="mt-1 text-xs text-map-muted/75">
          {t('စာပြန်ပို့လျှင် တိုင်ကြားချက်ကို ပြန်လည်စစ်ဆေးပါမည်။', 'Replies reopen the report.')}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ code, label }: { readonly code: string; readonly label: string }) {
  const tone = STATUS_BADGE[code] ?? 'bg-neutral-100 text-neutral-600 ring-neutral-200';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tone}`}>
      {label}
    </span>
  );
}

function targetLabel(report: MyReport, languageMode: 'my' | 'en' | 'both'): string | null {
  const myanmar = languageMode !== 'en';
  if (report.target_entity_type === 'map_point') {
    if (typeof report.latitude === 'number' && typeof report.longitude === 'number') {
      return `${myanmar ? 'မြေပုံအမှတ်' : 'Map point'} · ${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`;
    }
    return myanmar ? 'မြေပုံအမှတ်' : 'Map point';
  }
  if (report.target_entity_type) {
    const labels = myanmar ? TARGET_LABELS_MY : TARGET_LABELS;
    const label = labels[report.target_entity_type] ?? report.target_entity_type;
    return report.target_entity_id ? `${label} #${report.target_entity_id}` : label;
  }
  return null;
}

function formatDate(value: string, languageMode: 'my' | 'en' | 'both'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(languageMode === 'en' ? 'en-US' : 'my-MM', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
