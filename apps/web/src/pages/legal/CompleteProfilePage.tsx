import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, publicJson } from '@/features/auth/api/http';
import { setAccessToken } from '@/features/auth/lib/tokenStorage';
import { setConnectProviderIntent } from '@/features/auth/lib/connectProviderIntent';
import type { SessionResponse } from '@/features/auth/types';

type Step = 'email' | 'otp' | 'link_required';

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'This email already belongs to a CoreMap account. Sign in to that account first, then connect the provider from Account → Security.';
    }
    if (error.status === 429) {
      return 'Please wait a moment before trying again.';
    }
    return error.message || 'Could not continue. Try again.';
  }
  if (error instanceof Error) return error.message;
  return 'Could not continue. Try again.';
}

export default function CompleteProfilePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const flowToken = params.get('flow')?.trim() ?? '';
  const [step, setStep] = useState<Step>(flowToken ? 'email' : 'email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const missingFlow = useMemo(() => flowToken.length < 20, [flowToken]);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (missingFlow) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await publicJson('/auth/oauth/complete-profile/send-otp', {
        flowToken,
        email: email.trim(),
      });
      setStep('otp');
      setInfo('We sent a verification code to your email.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setStep('link_required');
        setError(null);
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (missingFlow) return;
    setBusy(true);
    setError(null);
    try {
      const session = await publicJson<SessionResponse>('/auth/oauth/complete-profile/verify', {
        flowToken,
        email: email.trim(),
        code: code.trim(),
      });
      setAccessToken(session.accessToken);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setStep('link_required');
        setError(null);
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (missingFlow) {
    return (
      <article className="space-y-4 text-sm leading-6 text-map-ink">
        <h1 className="text-2xl font-semibold">Complete your CoreMap account</h1>
        <p>This sign-up link expired or is invalid. Start again with Google sign-in.</p>
        <Link to="/?auth=login" className="text-map-primary underline">
          Return to sign in
        </Link>
      </article>
    );
  }

  if (step === 'link_required') {
    return (
      <article className="space-y-4 text-sm leading-6 text-map-ink">
        <h1 className="text-2xl font-semibold">Email already in use</h1>
        <p>
          This email already belongs to a CoreMap account. Sign in to that account first, then
          connect that provider from Account → Security.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <Link
            to="/?auth=login"
            className="text-map-primary underline"
            onClick={() => setConnectProviderIntent('pending')}
          >
            Sign in
          </Link>
          <Link to="/" className="text-map-primary underline">
            Return to the map
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className="space-y-4 text-sm leading-6 text-map-ink">
      <h1 className="text-2xl font-semibold">Complete your CoreMap account</h1>
      <p>
        Facebook did not share an email with CoreMap. Enter an email you can access, verify it,
        then finish creating your account.
      </p>

      {step === 'email' ? (
        <form className="space-y-3" onSubmit={(event) => void sendCode(event)}>
          <label className="block space-y-1">
            <span className="font-medium">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border border-map-border bg-map-surface px-3 py-2"
            />
          </label>
          {error ? <p className="text-red-700" role="alert">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-map-primary px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Send verification code'}
          </button>
        </form>
      ) : (
        <form className="space-y-3" onSubmit={(event) => void verifyCode(event)}>
          <p className="text-map-muted">Code sent to {email}</p>
          <label className="block space-y-1">
            <span className="font-medium">Verification code</span>
            <input
              inputMode="numeric"
              pattern="\d{6}"
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="w-full rounded-md border border-map-border bg-map-surface px-3 py-2"
            />
          </label>
          {info ? <p className="text-map-muted" role="status">{info}</p> : null}
          {error ? <p className="text-red-700" role="alert">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-map-primary px-4 py-2 font-medium text-white disabled:opacity-60"
            >
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
            <button
              type="button"
              disabled={busy}
              className="text-map-primary underline disabled:opacity-60"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
                setInfo(null);
              }}
            >
              Change email
            </button>
          </div>
        </form>
      )}

      <Link to="/" className="inline-block text-map-primary underline">
        Cancel / Return to map
      </Link>
    </article>
  );
}
