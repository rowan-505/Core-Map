import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/state/useAuth';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import {
  ApiError,
  createCommunityPost,
  patchCommunityPost,
  type CommunityFeed,
  type CommunityLocation,
  type CommunityPostDetail,
  type CommunityPostListItem,
} from '../api/communityApi';
import {
  useCommunityFeed,
  useMyCommunityPosts,
} from '../api/useCommunityData';
import {
  isCommunityCategoryCode,
  type CommunityCategoryCode,
} from '../lib/communityCategories';
import { CommunityPostCard } from './CommunityPostCard';
import { CommunityPostDetailView } from './CommunityPostDetailView';
import {
  CommunityPostForm,
  type CommunityPostFormValues,
} from './CommunityPostForm';
import { ComposeFab, ListSkeleton, PanelEmptyState, SegmentedTabs } from '@/components/ui/sidebarUi';

export type CommunityTab = 'latest' | 'trusted' | 'mine';
type PanelView = 'list' | 'detail' | 'create' | 'edit';

type CommunityPanelProps = {
  readonly selectedPostId: string | null;
  readonly onSelectPost: (publicId: string | null) => void;
  readonly draftLocation: CommunityLocation | null;
  readonly onFocusLocation?: (lng: number, lat: number) => void;
  readonly activeFeed: CommunityFeed;
  readonly onActiveFeedChange: (feed: CommunityFeed) => void;
  /** When true, open create form once (e.g. after auth). */
  readonly requestCreate?: boolean;
  readonly onCreateRequestHandled?: () => void;
};

export function CommunityPanel({
  selectedPostId,
  onSelectPost,
  draftLocation,
  onFocusLocation,
  activeFeed,
  onActiveFeedChange,
  requestCreate = false,
  onCreateRequestHandled,
}: CommunityPanelProps) {
  const t = useMapUiText();
  const { isAuthenticated, openAuthModal, user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CommunityTab>(
    activeFeed === 'trusted' ? 'trusted' : 'latest',
  );
  const [view, setView] = useState<PanelView>(selectedPostId ? 'detail' : 'list');
  const [editingPost, setEditingPost] = useState<CommunityPostDetail | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPostId) {
      setView('detail');
      return;
    }
    if (view === 'detail') setView('list');
  }, [selectedPostId]); // eslint-disable-line react-hooks/exhaustive-deps -- only sync on selection change

  useEffect(() => {
    if (!requestCreate) return;
    if (!isAuthenticated) {
      openAuthModal('login');
      onCreateRequestHandled?.();
      return;
    }
    setView('create');
    setFormError(null);
    onCreateRequestHandled?.();
  }, [requestCreate, isAuthenticated, openAuthModal, onCreateRequestHandled]);

  const feed: CommunityFeed = tab === 'trusted' ? 'trusted' : 'latest';
  const feedQuery = useCommunityFeed({
    feed,
    enabled: tab !== 'mine',
  });
  const mineQuery = useMyCommunityPosts({
    enabled: tab === 'mine' && isAuthenticated,
  });

  const createMutation = useMutation({
    mutationFn: createCommunityPost,
    onSuccess: (post) => {
      void queryClient.invalidateQueries({ queryKey: ['community'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      onSelectPost(post.public_id);
      setView('detail');
      setFormError(null);
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError
          ? error.message
          : t('ဖန်တီး၍မရပါ', 'Could not create post'),
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: (input: {
      publicId: string;
      values: CommunityPostFormValues;
      location: CommunityLocation | null;
    }) =>
      patchCommunityPost(input.publicId, {
        title: input.values.title,
        description: input.values.description,
        category: input.values.category,
        location: input.values.includeLocation ? input.location : null,
      }),
    onSuccess: (post) => {
      void queryClient.invalidateQueries({ queryKey: ['community'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setEditingPost(null);
      onSelectPost(post.public_id);
      setView('detail');
      setFormError(null);
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError
          ? error.message
          : t('သိမ်း၍မရပါ', 'Could not save changes'),
      );
    },
  });

  const items = useMemo(() => {
    if (tab === 'mine') {
      return flattenPages(mineQuery.data?.pages);
    }
    return flattenPages(feedQuery.data?.pages);
  }, [tab, feedQuery.data, mineQuery.data]);

  const listLoading = tab === 'mine' ? mineQuery.isLoading : feedQuery.isLoading;
  const listError = tab === 'mine' ? mineQuery.isError : feedQuery.isError;
  const hasMore =
    tab === 'mine' ? Boolean(mineQuery.hasNextPage) : Boolean(feedQuery.hasNextPage);
  const loadingMore =
    tab === 'mine' ? mineQuery.isFetchingNextPage : feedQuery.isFetchingNextPage;

  if (view === 'create') {
    return (
      <CommunityPostForm
        defaultLocation={draftLocation}
        submitLabel={t('တင်မည်', 'Post')}
        pending={createMutation.isPending}
        errorMessage={formError}
        onCancel={() => {
          setView('list');
          setFormError(null);
        }}
        onSubmit={(values) => {
          createMutation.mutate({
            title: values.title,
            description: values.description,
            category: values.category,
            location: values.includeLocation ? draftLocation : null,
          });
        }}
      />
    );
  }

  if (view === 'edit' && editingPost) {
    const category: CommunityCategoryCode = isCommunityCategoryCode(editingPost.category)
      ? editingPost.category
      : 'other';
    return (
      <CommunityPostForm
        initial={{
          title: editingPost.title,
          description: editingPost.description,
          category,
          includeLocation: Boolean(editingPost.location),
        }}
        defaultLocation={editingPost.location ?? draftLocation}
        submitLabel={t('သိမ်းမည်', 'Save')}
        pending={editMutation.isPending}
        errorMessage={formError}
        onCancel={() => {
          setEditingPost(null);
          setView('detail');
          setFormError(null);
        }}
        onSubmit={(values) => {
          editMutation.mutate({
            publicId: editingPost.public_id,
            values,
            location: values.includeLocation
              ? (editingPost.location ?? draftLocation)
              : null,
          });
        }}
      />
    );
  }

  if (view === 'detail' && selectedPostId) {
    return (
      <CommunityPostDetailView
        publicId={selectedPostId}
        onBack={() => {
          onSelectPost(null);
          setView('list');
        }}
        onEdit={(post) => {
          setEditingPost(post);
          setView('edit');
          setFormError(null);
        }}
        onDeleted={() => {
          onSelectPost(null);
          setView('list');
        }}
        onFocusLocation={onFocusLocation}
      />
    );
  }

  return (
    <section className="relative flex min-h-0 flex-col" aria-label={t('လူမှုအသိုင်းအဝိုင်း', 'Community')}>
      <div className="sticky top-0 z-10 border-b border-map-border/70 bg-map-surface px-4 py-3">
        <SegmentedTabs
          label={t('လူမှုအသိုင်းအဝိုင်း စစ်ထုတ်ရန်', 'Community filters')}
          value={tab}
          onChange={(id) => {
            if (id === 'mine' && !isAuthenticated) {
              openAuthModal('login');
              return;
            }
            setTab(id);
            if (id === 'latest' || id === 'trusted') {
              onActiveFeedChange(id);
            }
            onSelectPost(null);
            setView('list');
          }}
          items={[
            { id: 'latest', label: t('နောက်ဆုံး', 'Latest') },
            { id: 'trusted', label: t('ယုံကြည်ရ', 'Trusted') },
            { id: 'mine', label: t('ကျွန်ုပ်၏', 'Mine') },
          ]}
        />
      </div>

      {tab === 'mine' && !isAuthenticated ? (
        <PanelEmptyState
          title={t('သင့်ပို့စ်များကို ကြည့်ရန်', 'See your posts')}
          body={t('သင့်ပို့စ်များကို ကြည့်ရန် အကောင့်ဝင်ပါ။', 'Sign in to view My Posts.')}
          action={
            <button
              type="button"
              className="rounded-map-control bg-map-primary px-4 py-2 text-sm font-semibold text-white"
              onClick={() => openAuthModal('login')}
            >
              {t('အကောင့်ဝင်ရန်', 'Sign in')}
            </button>
          }
        />
      ) : listLoading ? (
        <ListSkeleton rows={5} />
      ) : listError ? (
        <PanelEmptyState
          tone="error"
          title={t('လူမှုအသိုင်းအဝိုင်းကို မရရှိနိုင်ပါ', 'Community unavailable')}
        />
      ) : items.length === 0 ? (
        <PanelEmptyState
          title={t('ပို့စ် မရှိသေးပါ', 'No posts yet')}
          body={
            tab === 'trusted'
              ? t(
                  'လူမှုအသိုင်းအဝိုင်း အတည်ပြု သို့မဟုတ် CoreMap အတည်ပြု ပို့စ် မရှိသေးပါ။',
                  'No Community Confirmed or CoreMap Verified posts yet.',
                )
              : t('ပထမဆုံး ပို့စ်ကို တင်နိုင်သည်။', 'Be the first to post.')
          }
        />
      ) : (
        <div className="pb-16">
          {items.map((post) => (
            <CommunityPostCard
              key={post.public_id}
              post={post}
              selected={selectedPostId === post.public_id}
              onSelect={(id) => {
                onSelectPost(id);
                setView('detail');
                if (post.location) {
                  onFocusLocation?.(post.location.lng, post.location.lat);
                }
              }}
            />
          ))}
          {hasMore ? (
            <div className="px-4 py-3">
              <button
                type="button"
                className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm font-semibold text-map-ink hover:bg-map-primary-soft disabled:opacity-50"
                disabled={loadingMore}
                onClick={() => {
                  if (tab === 'mine') {
                    void mineQuery.fetchNextPage();
                  } else {
                    void feedQuery.fetchNextPage();
                  }
                }}
              >
                {loadingMore
                  ? t('ဖွင့်နေသည်…', 'Loading…')
                  : t('နောက်ထပ် ကြည့်ရန်', 'Load more')}
              </button>
            </div>
          ) : null}
          {user && tab === 'mine' ? (
            <p className="px-4 pb-3 text-[12px] text-map-muted">
              {t('သင့်အကောင့်', 'Signed in as')} {user.display_name}
            </p>
          ) : null}
        </div>
      )}

      <ComposeFab
        label={t('ပို့စ်အသစ်', 'New post')}
        onClick={() => {
          if (!isAuthenticated) {
            openAuthModal('login');
            return;
          }
          setView('create');
          setFormError(null);
        }}
      />
    </section>
  );
}

function flattenPages(
  pages: readonly { readonly items: readonly CommunityPostListItem[] }[] | undefined,
): CommunityPostListItem[] {
  if (!pages) return [];
  return pages.flatMap((page) => [...page.items]);
}
