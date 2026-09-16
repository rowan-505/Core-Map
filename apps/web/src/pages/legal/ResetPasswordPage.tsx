import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { publicJson } from '@/features/auth/api/http';

/**
 * Password reset token arrives in the query string (email link).
 * Remaining risk: the raw token may appear in browser history / Referer until
 * stripped. We capture it into memory and remove it from the visible URL ASAP.
 * Server stores only a hash; tokens are short-lived and single-use.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const queryToken = useMemo(() => params.get('token')?.trim() ?? '', [params]);
  const [token, setToken] = useState(queryToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!queryToken) return;
    setToken(queryToken);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('token')) {
        url.searchParams.delete('token');
        const next = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState(window.history.state, '', next);
      }
    } catch {
      // Best-effort URL hygiene only.
    }
  }, [queryToken]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await publicJson('/auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <article className="space-y-3 text-sm">
        <h1 className="text-2xl font-semibold">Reset password</h1>
        <p>This reset link is missing or incomplete. Request a new one.</p>
        <Link to="/forgot-password" className="text-map-primary underline">
          Forgot password
        </Link>
      </article>
    );
  }

  return (
    <article className="space-y-4 text-sm leading-6 text-map-ink">
      <h1 className="text-2xl font-semibold">Reset password</h1>
      {done ? (
        <p className="rounded-map-card border border-map-border bg-map-surface px-4 py-3">
          Password updated. You can sign in on the map with the new password. Other devices were
          signed out.
        </p>
      ) : (
        <form className="max-w-sm space-y-3" onSubmit={(event) => void onSubmit(event)}>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-map-muted">New password</span>
            <input
              type="password"
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-map-muted">Confirm password</span>
            <input
              type="password"
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2"
            />
          </label>
          {error ? <p className="text-map-error">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-map-control bg-map-primary px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
      )}
      <Link to="/" className="text-map-primary underline">
        Back to the map
      </Link>
    </article>
  );
}
