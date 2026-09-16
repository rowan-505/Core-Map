import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { setConnectProviderIntent } from '@/features/auth/lib/connectProviderIntent';

const MESSAGES: Record<string, string> = {
  auth_failed: 'Sign-in with that provider did not complete. You can try again or use email.',
  link_required:
    'That email already belongs to a CoreMap account. Sign in with your email and password first, then connect Google from Account → Security.',
  existing_account_link_required:
    'This email already belongs to a CoreMap account. Sign in to that account first, then connect the provider from Account → Security.',
  dashboard_forbidden: 'This CoreMap account does not have dashboard access.',
  oauth_disabled: 'That sign-in method is not enabled yet.',
  feature_disabled: 'That sign-in method is not available in this release.',
  identity_taken: 'That provider account is already linked to another CoreMap user.',
  already_linked: 'That provider is already connected to your account.',
  last_auth_method: 'Keep at least one sign-in method on your account.',
  oauth_expired: 'This sign-in step expired. Please start again.',
  provider_error: 'The sign-in provider returned an error. Try again in a moment.',
  oauth_state_invalid: 'Sign-in expired. Please try again.',
};

export default function OAuthResultPage() {
  const [params] = useSearchParams();
  const error = params.get('error')?.trim() ?? '';
  const message = MESSAGES[error] ?? 'Could not complete sign-in.';
  const linkRequired = error === 'link_required' || error === 'existing_account_link_required';

  const home = useMemo(() => '/', []);
  const signInHref = useMemo(() => '/?auth=login', []);

  return (
    <article className="space-y-4 text-sm leading-6 text-map-ink">
      <h1 className="text-2xl font-semibold">Sign-in did not finish</h1>
      <p>{message}</p>
      {linkRequired ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <Link
            to={signInHref}
            className="text-map-primary underline"
            onClick={() => setConnectProviderIntent('pending')}
          >
            Sign in to existing account
          </Link>
          <Link to={home} className="text-map-primary underline">
            Return to the map
          </Link>
        </div>
      ) : (
        <Link to={home} className="text-map-primary underline">
          Return to the map
        </Link>
      )}
      {linkRequired ? (
        <p className="text-map-muted">
          After you sign in, open Account → Security and choose Connect for that provider. CoreMap
          will not attach a provider account based on email alone.
        </p>
      ) : null}
    </article>
  );
}
