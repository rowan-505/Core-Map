import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/state/useAuth';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import {
  ApiError,
  deleteCommunityPost,
  type CommunityPostDetail,
} from '../api/communityApi';
import { communityCategoryLabel } from '../lib/communityCategories';
import { useCommunityPostDetail } from '../api/useCommunityData';
import {
  CommunityPublicationBadge,
  CommunityVerificationBadge,
} from './CommunityBadges';
import { CommunityReactions } from './CommunityReactions';

type CommunityPostDetailViewProps = {
  readonly publicId: string;
  readonly onBack: () => void;
  readonly onEdit: (post: CommunityPostDetail) => void;
  readonly onDeleted: () => void;
  readonly onFocusLocation?: (lng: number, lat: number) => void;
};

export function CommunityPostDetailView({
  publicId,
  onBack,
  onEdit,
  onDeleted,
  onFocusLocation,
}: CommunityPostDetailViewProps) {
  const t = useMapUiText();
  const { user, isAuthenticated, openAuthModal } = useAuth();
  const queryClient = useQueryClient();
  const detailQuery = useCommunityPostDetail({ publicId });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCommunityPost(publicId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['community'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      onDeleted();
    },
  });

  if (detailQuery.isLoading) {
    return (
      <section className="p-4">
        <p className="text-sm text-map-muted">{t('ဖွင့်နေသည်…', 'Loading…')}</p>
      </section>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <section className="space-y-3 p-4">
        <button
          type="button"
          className="text-sm font-semibold text-map-primary"
          onClick={onBack}
        >
          {t('← ပြန်သွားရန်', '← Back')}
        </button>
        <p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {t('ပို့စ်ကို ဖွင့်၍မရပါ', 'Post unavailable')}
        </p>
      </section>
    );
  }

  const post = detailQuery.data;
  const isOwner = Boolean(user && user.public_id === post.author.public_id);
  const canEdit =
    isOwner && post.publication_status === 'published';
  const canDelete = isOwner && post.publication_status !== 'removed';

  return (
    <section className="space-y-4 p-3.5" aria-label={t('ပို့စ်အသေးစိတ်', 'Post detail')}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-sm font-semibold text-map-primary"
          onClick={onBack}
        >
          {t('← ပြန်သွားရန်', '← Back')}
        </button>
        {(canEdit || canDelete) && (
          <div className="flex gap-2">
            {canEdit ? (
              <button
                type="button"
                className="rounded-map-control border border-map-border px-2.5 py-1 text-xs font-semibold text-map-ink hover:bg-map-primary-soft"
                onClick={() => onEdit(post)}
              >
                {t('ပြင်ဆင်', 'Edit')}
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className="rounded-map-control border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuthModal('login');
                    return;
                  }
                  if (
                    !window.confirm(
                      t('ဤပို့စ်ကို ဖျက်မည်လား?', 'Delete this post?'),
                    )
                  ) {
                    return;
                  }
                  deleteMutation.mutate();
                }}
              >
                {t('ဖျက်ရန်', 'Delete')}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <CommunityVerificationBadge status={post.verification_status} />
        <CommunityPublicationBadge status={post.publication_status} />
        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
          {communityCategoryLabel(post.category, t)}
        </span>
      </div>

      <div>
        <h2 className="text-base font-semibold leading-6 text-map-ink">{post.title}</h2>
        <p className="mt-1 text-xs text-map-muted">
          {post.author.display_name} · {formatDateTime(post.published_at)}
        </p>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-6 text-map-ink">{post.description}</p>

      {post.location ? (
        <button
          type="button"
          className="w-full rounded-map-card border border-map-border bg-map-primary-soft/50 px-3 py-2.5 text-left text-sm text-map-ink"
          onClick={() => onFocusLocation?.(post.location!.lng, post.location!.lat)}
        >
          <span className="block text-xs font-semibold uppercase tracking-wide text-map-muted">
            {t('တည်နေရာ', 'Location')}
          </span>
          <span className="mt-0.5 block">
            {post.location.label ??
              `${post.location.lat.toFixed(5)}, ${post.location.lng.toFixed(5)}`}
          </span>
        </button>
      ) : null}

      <CommunityReactions post={post} />

      {deleteMutation.isError ? (
        <p className="text-xs text-red-600">
          {deleteMutation.error instanceof ApiError
            ? deleteMutation.error.message
            : t('ဖျက်၍မရပါ', 'Delete failed')}
        </p>
      ) : null}
    </section>
  );
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
