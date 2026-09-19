import { communityCategoryLabel } from '../lib/communityCategories';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import type { CommunityPostListItem } from '../api/communityApi';
import {
  CommunityPublicationBadge,
  CommunityVerificationBadge,
} from './CommunityBadges';

type CommunityPostCardProps = {
  readonly post: CommunityPostListItem;
  readonly selected?: boolean;
  readonly onSelect: (publicId: string) => void;
};

export function CommunityPostCard({
  post,
  selected = false,
  onSelect,
}: CommunityPostCardProps) {
  const t = useMapUiText();
  const reactionTotal =
    post.reaction_counts.confirm +
    post.reaction_counts.helpful +
    post.reaction_counts.incorrect;
  const locationLabel = post.location?.label ?? (post.has_location ? t('မြေပုံပေါ်တွင် ရှိသည်', 'On map') : null);

  return (
    <button
      type="button"
      onClick={() => onSelect(post.public_id)}
      className={`flex min-h-16 w-full flex-col gap-1 border-b border-map-border/70 px-4 py-3 text-left transition-colors duration-150 ${
        selected ? 'bg-map-primary-soft shadow-[inset_3px_0_0_#0f68e8]' : 'hover:bg-map-primary-soft/60'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <CommunityVerificationBadge status={post.verification_status} />
        <CommunityPublicationBadge status={post.publication_status} />
        <span className="rounded-md bg-map-bg px-1.5 py-0.5 text-[11px] font-medium text-map-muted">
          {communityCategoryLabel(post.category, t)}
        </span>
      </div>
      <p className="map-clamp-2 text-[15px] font-semibold leading-[1.55] text-map-ink">
        {post.title}
      </p>
      <div className="flex min-w-0 items-center gap-2 text-[12px] leading-5 text-map-muted">
        <span className="truncate">{post.author.display_name}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0 tabular-nums">{formatRelativeDate(post.published_at, t)}</span>
        {reactionTotal > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {t(`${reactionTotal} တုံ့ပြန်`, `${reactionTotal}`)}
            </span>
          </>
        ) : null}
      </div>
      {locationLabel ? (
        <p className="map-clamp-1 text-[12px] text-map-muted">{locationLabel}</p>
      ) : null}
    </button>
  );
}

function formatRelativeDate(
  iso: string,
  t: (myanmar: string, english: string) => string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return t('ယခု', 'Just now');
  if (minutes < 60) return t(`${minutes} မိနစ်`, `${minutes}m`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t(`${hours} နာရီ`, `${hours}h`);
  const days = Math.round(hours / 24);
  if (days < 7) return t(`${days} ရက်`, `${days}d`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
