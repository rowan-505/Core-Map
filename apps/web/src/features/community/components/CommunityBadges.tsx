import { useMapUiText } from '@/features/map/i18n/mapUiText';
import type {
  CommunityPublicationStatus,
  CommunityVerificationStatus,
} from '../api/communityApi';

export function CommunityVerificationBadge({
  status,
}: {
  readonly status: CommunityVerificationStatus;
}) {
  const t = useMapUiText();

  if (status === 'admin_verified') {
    return (
      <span className="inline-flex items-center rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-800 ring-1 ring-teal-200/80">
        {t('CoreMap အတည်ပြု', 'CoreMap Verified')}
      </span>
    );
  }

  if (status === 'community_confirmed') {
    return (
      <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-800 ring-1 ring-blue-200/80">
        {t('လူမှုအသိုင်းအဝိုင်း အတည်ပြု', 'Community Confirmed')}
      </span>
    );
  }

  return null;
}

export function CommunityPublicationBadge({
  status,
}: {
  readonly status: CommunityPublicationStatus;
}) {
  const t = useMapUiText();

  if (status === 'published') return null;

  const meta: Record<
    Exclude<CommunityPublicationStatus, 'published'>,
    { label: string; className: string }
  > = {
    resolved: {
      label: t('ဖြေရှင်းပြီး', 'Resolved'),
      className: 'bg-emerald-50 text-emerald-800 ring-emerald-200/80',
    },
    expired: {
      label: t('သက်တမ်းကုန်', 'Expired'),
      className: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
    },
    rejected: {
      label: t('ငြင်းပယ်', 'Rejected'),
      className: 'bg-red-50 text-red-700 ring-red-100',
    },
    removed: {
      label: t('ဖယ်ရှား', 'Removed'),
      className: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
    },
  };

  const item = meta[status];
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${item.className}`}
    >
      {item.label}
    </span>
  );
}
