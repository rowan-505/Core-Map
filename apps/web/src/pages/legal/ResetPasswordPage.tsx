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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
          <PasswordInput
            label="New password"
            value={password}
            onChange={setPassword}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((current) => !current)}
            autoComplete="new-password"
          />
          <PasswordInput
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            visible={showConfirm}
            onToggleVisible={() => setShowConfirm((current) => !current)}
            autoComplete="new-password"
          />
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

function PasswordInput({
  label,
  value,
  onChange,
  visible,
  onToggleVisible,
  autoComplete,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly visible: boolean;
  readonly onToggleVisible: () => void;
  readonly autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-map-muted">{label}</span>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          required
          minLength={8}
          maxLength={200}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 pr-10"
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-map-muted hover:text-map-ink"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={onToggleVisible}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </label>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2.75 2.75 0 0 0 3.8 3.8" />
      <path d="M9.9 5.5A10.3 10.3 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.7 16.7 0 0 1-3.1 3.7" />
      <path d="M6.1 6.2A16.4 16.4 0 0 0 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.2 3.6-.6" />
    </svg>
  );
}
