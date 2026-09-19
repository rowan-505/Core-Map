import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/features/auth/api/http';
import { useAuth } from '@/features/auth/state/useAuth';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { SidebarSectionTitle } from '@/components/ui/sidebarUi';
import {
  createPlaceReview,
  deletePlaceReview,
  updatePlaceReview,
} from '../api/placeReviewsApi';
import type { PlaceReviewOwner } from '../api/placeReviewsApiTypes';
import {
  myPlaceReviewQueryKey,
  publishedPlaceReviewsQueryKey,
  useMyPlaceReview,
  usePublishedPlaceReviews,
} from '../api/usePlaceReviews';
import {
  filterPublishedReviewsOnly,
  flattenPlaceReviewPages,
  resolvePlaceReviewsUiState,
} from '../lib/placeReviewListState';
import {
  placeReviewResubmitNotice,
  placeReviewStatusLabel,
  resolveAuthorReviewView,
  shouldShowCreateReviewForm,
} from '../lib/placeReviewStatus';
import { isDuplicatePlaceReviewError } from '../lib/validatePlaceReview';
import { PlaceReviewForm, type PlaceReviewFormValues } from './PlaceReviewForm';
import { PlaceReviewItem } from './PlaceReviewItem';

export function PlaceReviewsPanel({ placePublicId }: { readonly placePublicId: string }) {
  const t = useMapUiText();
  const { isAuthenticated, openAuthModal } = useAuth();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const reviewsQuery = usePublishedPlaceReviews({ placePublicId });
  const myReviewQuery = useMyPlaceReview({
    placePublicId,
    enabled: isAuthenticated,
  });
  const publishedItems = useMemo(
    () => filterPublishedReviewsOnly(flattenPlaceReviewPages(reviewsQuery.data?.pages)),
    [reviewsQuery.data?.pages],
  );
  const listState = resolvePlaceReviewsUiState({
    isLoading: reviewsQuery.isPending || (reviewsQuery.isFetching && publishedItems.length === 0),
    isError: reviewsQuery.isError,
    errorMessage:
      reviewsQuery.error instanceof ApiError
        ? reviewsQuery.error.message
        : t('သုံးသပ်ချက် မရနိုင်ပါ', 'Reviews unavailable'),
    items: publishedItems,
    hasMore: Boolean(reviewsQuery.hasNextPage),
    loadingMore: reviewsQuery.isFetchingNextPage,
  });
  const authorView = resolveAuthorReviewView(myReviewQuery.data);
  const showCreate = shouldShowCreateReviewForm({
    isAuthenticated,
    myReview: myReviewQuery.data,
    isEditing,
  });

  const invalidateReviewQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: publishedPlaceReviewsQueryKey(placePublicId, 20) }),
      queryClient.invalidateQueries({ queryKey: myPlaceReviewQueryKey(placePublicId) }),
      queryClient.invalidateQueries({ queryKey: ['tourism', 'profile', placePublicId] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (values: PlaceReviewFormValues) => createPlaceReview(placePublicId, values),
    onSuccess: async () => {
      setFormError(null);
      setFormNotice(null);
      setFormSuccess(t('ပေးပို့ပြီး။ စစ်ဆေးပြီးမှ ထုတ်ဝေပါမည်။', 'Submitted. It will be public after moderation.'));
      await invalidateReviewQueries();
    },
    onError: (error) => {
      setFormSuccess(null);
      if (error instanceof ApiError && error.status === 401) {
        openAuthModal('login');
        setFormError(null);
      } else if (error instanceof ApiError && isDuplicatePlaceReviewError(error)) {
        setFormError(t('ဤနေရာအတွက် သုံးသပ်ချက် ရှိပြီးသားဖြစ်သည်။', 'You already have a review for this place.'));
      } else {
        setFormError(error instanceof ApiError ? error.message : t('ပေးပို့၍မရပါ', 'Could not submit review'));
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { reviewId: string; values: PlaceReviewFormValues; wasPublished: boolean }) =>
      updatePlaceReview(input.reviewId, {
        rating: input.values.rating,
        title: input.values.title ?? null,
        body: input.values.body ?? null,
      }),
    onSuccess: async (_data, variables) => {
      setFormError(null);
      setIsEditing(false);
      setFormSuccess(t('သိမ်းပြီး', 'Saved'));
      setFormNotice(variables.wasPublished ? placeReviewResubmitNotice(t) : null);
      await invalidateReviewQueries();
    },
    onError: (error) => {
      setFormSuccess(null);
      if (error instanceof ApiError && error.status === 401) {
        openAuthModal('login');
      } else {
        setFormError(error instanceof ApiError ? error.message : t('ပြင်ဆင်၍မရပါ', 'Could not update review'));
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (reviewId: string) => deletePlaceReview(reviewId),
    onSuccess: async () => {
      setFormError(null);
      setFormNotice(null);
      setFormSuccess(t('သုံးသပ်ချက် ဖျက်ပြီး', 'Review deleted'));
      setIsEditing(false);
      await invalidateReviewQueries();
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof ApiError ? error.message : t('ဖျက်၍မရပါ', 'Could not delete review'));
    },
  });

  return (
    <div className="space-y-3">
      <SidebarSectionTitle>{t('သုံးသပ်ချက်များ', 'Reviews')}</SidebarSectionTitle>

      {!isAuthenticated ? (
        <div className="rounded-map-card border border-dashed border-map-border bg-map-bg/80 p-3">
          <p className="text-sm text-map-muted">{t('သုံးသပ်ချက်ရေးရန် အကောင့်ဝင်ပါ။', 'Sign in to write a review.')}</p>
          <button type="button" className="mt-2 min-h-10 rounded-map-control border border-map-primary bg-map-primary px-3 text-sm font-semibold text-white" onClick={() => openAuthModal('login')}>
            {t('အကောင့်ဝင်ရန်', 'Sign in')}
          </button>
        </div>
      ) : null}

      {isAuthenticated && authorView.kind === 'owned' && !isEditing ? (
        <AuthorReviewCard
          review={authorView.review}
          busy={deleteMutation.isPending}
          onEdit={() => {
            setFormError(null);
            setFormSuccess(null);
            setFormNotice(null);
            setIsEditing(true);
          }}
          onDelete={() => void deleteMutation.mutateAsync(authorView.review.public_id)}
        />
      ) : null}

      {isAuthenticated && isEditing && authorView.kind === 'owned' ? (
        <PlaceReviewForm
          initialRating={authorView.review.rating}
          initialTitle={authorView.review.title}
          initialBody={authorView.review.body}
          submitLabel={t('သိမ်းရန်', 'Save')}
          pending={updateMutation.isPending}
          errorMessage={formError}
          successMessage={formSuccess}
          noticeMessage={authorView.review.status === 'published' ? placeReviewResubmitNotice(t) : formNotice}
          onCancel={() => {
            setIsEditing(false);
            setFormError(null);
          }}
          onSubmit={(values) => void updateMutation.mutateAsync({
            reviewId: authorView.review.public_id,
            values,
            wasPublished: authorView.review.status === 'published',
          })}
        />
      ) : null}

      {showCreate ? (
        <PlaceReviewForm
          submitLabel={t('ပေးပို့ရန်', 'Submit')}
          pending={createMutation.isPending}
          errorMessage={formError}
          successMessage={formSuccess}
          onSubmit={(values) => void createMutation.mutateAsync(values)}
        />
      ) : null}

      {formSuccess && !showCreate && !isEditing ? <p className="text-xs text-emerald-700" role="status">{formSuccess}</p> : null}
      {formNotice && !isEditing ? <p className="text-xs text-amber-800" role="status">{formNotice}</p> : null}
      {formError && !showCreate && !isEditing ? <p className="text-xs text-red-600" role="alert">{formError}</p> : null}

      <div className="space-y-2">
        <SidebarSectionTitle trailing={listState.kind === 'ready' ? t(`${listState.items.length} ခု`, `${listState.items.length}`) : undefined}>
          {t('ထုတ်ဝေပြီး သုံးသပ်ချက်များ', 'Published reviews')}
        </SidebarSectionTitle>
        {listState.kind === 'loading' ? <p className="text-sm text-map-muted">{t('ဖွင့်နေသည်…', 'Loading…')}</p> : null}
        {listState.kind === 'error' ? (
          <div className="rounded-map-card border border-dashed border-red-200 bg-red-50/60 p-3">
            <p className="text-sm text-red-700">{listState.message}</p>
            <button type="button" className="mt-2 min-h-10 text-sm font-semibold text-map-primary" onClick={() => void reviewsQuery.refetch()}>
              {t('ပြန်ကြိုးစားရန်', 'Retry')}
            </button>
          </div>
        ) : null}
        {listState.kind === 'empty' ? <p className="text-sm text-map-muted">{t('ထုတ်ဝေပြီး သုံးသပ်ချက် မရှိသေးပါ။', 'No published reviews yet.')}</p> : null}
        {listState.kind === 'ready' ? listState.items.map((review) => <PlaceReviewItem key={review.public_id} review={review} />) : null}
        {listState.kind === 'ready' && listState.hasMore ? (
          <button type="button" className="flex min-h-11 w-full items-center justify-center rounded-map-control border border-map-border bg-map-surface text-sm font-semibold text-map-ink disabled:opacity-55" disabled={listState.loadingMore} onClick={() => void reviewsQuery.fetchNextPage()}>
            {listState.loadingMore ? t('ဆက်ဖွင့်နေသည်…', 'Loading more…') : t('နောက်ထပ် ကြည့်ရန်', 'Load more')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AuthorReviewCard({
  review,
  busy,
  onEdit,
  onDelete,
}: {
  readonly review: PlaceReviewOwner;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const t = useMapUiText();
  return (
    <div className="rounded-map-card border border-map-primary/25 bg-map-primary-soft/40 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-map-ink">{t('သင့်သုံးသပ်ချက်', 'Your review')}</span>
        <span className="rounded-md bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-map-primary">{placeReviewStatusLabel(review.status, t)}</span>
      </div>
      {review.status === 'pending' ? <p className="mt-1.5 text-xs text-map-muted">{t('စစ်ဆေးပြီးမှ အများပြည်သူ မြင်ရပါမည်။', 'Visible to the public after moderation.')}</p> : null}
      {review.status === 'rejected' ? <p className="mt-1.5 text-xs text-red-700">{t('ဤသုံးသပ်ချက်ကို ငြင်းပယ်ထားသည် (စာရေးသူသာ မြင်ရသည်)။', 'This review was rejected (visible only to you).')}{review.moderation_note ? ` ${review.moderation_note}` : ''}</p> : null}
      <p className="mt-2 text-sm font-semibold tabular-nums text-map-ink">{t(`အဆင့် ${review.rating}`, `${review.rating}/5`)}</p>
      {review.title ? <p className="mt-1 text-sm font-medium text-map-ink">{review.title}</p> : null}
      {review.body ? <p className="mt-1 text-sm text-map-muted">{review.body}</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="button" className="min-h-10 flex-1 rounded-map-control border border-map-border bg-map-surface text-sm font-semibold" disabled={busy} onClick={onEdit}>{t('ပြင်ရန်', 'Edit')}</button>
        <button type="button" className="min-h-10 flex-1 rounded-map-control border border-red-200 bg-red-50 text-sm font-semibold text-red-700" disabled={busy} onClick={onDelete}>{busy ? t('ဖျက်နေသည်…', 'Deleting…') : t('ဖျက်ရန်', 'Delete')}</button>
      </div>
    </div>
  );
}
