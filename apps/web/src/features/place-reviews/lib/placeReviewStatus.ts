import type { PlaceReviewOwner, PlaceReviewStatus } from '../api/placeReviewsApiTypes';

export type AuthorPlaceReviewView =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'owned';
      readonly review: PlaceReviewOwner;
      readonly showRejected: boolean;
      readonly showPending: boolean;
      readonly canEdit: boolean;
      readonly canDelete: boolean;
      readonly showCreateForm: boolean;
    };

export function resolveAuthorReviewView(
  myReview: PlaceReviewOwner | null | undefined,
): AuthorPlaceReviewView {
  if (!myReview) return { kind: 'none' };
  const active = isActiveAuthorStatus(myReview.status);
  return {
    kind: 'owned',
    review: myReview,
    showRejected: myReview.status === 'rejected',
    showPending: myReview.status === 'pending',
    canEdit: active && myReview.status !== 'deleted',
    canDelete: active && myReview.status !== 'deleted',
    showCreateForm: false,
  };
}

export function isActiveAuthorStatus(status: PlaceReviewStatus): boolean {
  return status === 'pending' || status === 'published' || status === 'rejected' || status === 'hidden';
}

export function shouldShowCreateReviewForm(input: {
  readonly isAuthenticated: boolean;
  readonly myReview: PlaceReviewOwner | null | undefined;
  readonly isEditing: boolean;
}): boolean {
  if (!input.isAuthenticated || input.isEditing) return false;
  return resolveAuthorReviewView(input.myReview).kind === 'none';
}

export function placeReviewStatusLabel(
  status: PlaceReviewStatus,
  t: (myanmar: string, english: string) => string,
): string {
  switch (status) {
    case 'pending': return t('စစ်ဆေးဆဲ', 'Pending review');
    case 'published': return t('ထုတ်ဝေပြီး', 'Published');
    case 'rejected': return t('ငြင်းပယ်ပြီး', 'Rejected');
    case 'hidden': return t('ဖုံးထားသည်', 'Hidden');
    case 'deleted': return t('ဖျက်ပြီး', 'Deleted');
    default: return status;
  }
}

export function placeReviewResubmitNotice(
  t: (myanmar: string, english: string) => string,
): string {
  return t(
    'သင့်သုံးသပ်ချက်ကို ပြင်ဆင်ပြီးဖြစ်သည်။ ထုတ်ဝေရန် ထပ်မံ စစ်ဆေးရမည်။',
    'Your review was updated and needs moderation again before it is public.',
  );
}
