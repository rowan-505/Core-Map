import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/state/useAuth';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import {
  ApiError,
  deleteCommunityReaction,
  putCommunityReaction,
  type CommunityPostDetail,
  type CommunityReactionType,
} from '../api/communityApi';
import { communityPostDetailQueryKey } from '../api/useCommunityData';

const REACTIONS: readonly {
  readonly type: CommunityReactionType;
  readonly labelMy: string;
  readonly labelEn: string;
}[] = [
  { type: 'confirm', labelMy: 'အတည်ပြု', labelEn: 'Confirm' },
  { type: 'helpful', labelMy: 'အသုံးဝင်', labelEn: 'Helpful' },
  { type: 'incorrect', labelMy: 'မှားယွင်း', labelEn: 'Incorrect' },
];

type CommunityReactionsProps = {
  readonly post: CommunityPostDetail;
};

export function CommunityReactions({ post }: CommunityReactionsProps) {
  const t = useMapUiText();
  const { isAuthenticated, openAuthModal } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (next: CommunityReactionType | null) => {
      if (next === null) {
        return deleteCommunityReaction(post.public_id);
      }
      return putCommunityReaction(post.public_id, next);
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(communityPostDetailQueryKey(post.public_id), detail);
      void queryClient.invalidateQueries({ queryKey: ['community'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const canReact = post.publication_status === 'published';
  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? t('တုံ့ပြန်မှု မအောင်မြင်ပါ', 'Reaction failed')
        : null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-map-muted">
        {t('တုံ့ပြန်မှုများ', 'Reactions')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {REACTIONS.map((reaction) => {
          const active = post.viewer_reaction === reaction.type;
          const count = post.reaction_counts[reaction.type];
          return (
            <button
              key={reaction.type}
              type="button"
              disabled={!canReact || mutation.isPending}
              className={`rounded-map-control px-2.5 py-1.5 text-xs font-semibold ring-1 transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 disabled:opacity-50 ${
                active
                  ? 'bg-map-primary text-white ring-map-primary'
                  : 'bg-map-surface text-map-ink ring-map-border hover:bg-map-primary-soft hover:text-map-primary'
              }`}
              onClick={() => {
                if (!isAuthenticated) {
                  openAuthModal('login');
                  return;
                }
                if (!canReact) return;
                mutation.mutate(active ? null : reaction.type);
              }}
            >
              {t(reaction.labelMy, reaction.labelEn)}
              <span className="ml-1 tabular-nums opacity-80">{count}</span>
            </button>
          );
        })}
      </div>
      {!canReact ? (
        <p className="text-xs text-map-muted">
          {t(
            'Published ပို့စ်များတွင်သာ တုံ့ပြန်နိုင်သည်။ Resolved သည် lifecycle အခြေအနေဖြစ်သည်။',
            'Reactions are only for published posts. Resolved is a lifecycle status, not a reaction.',
          )}
        </p>
      ) : null}
      {errorMessage ? <p className="text-xs text-red-600">{errorMessage}</p> : null}
    </div>
  );
}
