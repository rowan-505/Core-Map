import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { publicJson } from '@/features/auth/api/http';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await publicJson('/auth/password/forgot', { email: email.trim() });
      setDone(true);
    } catch {
      setError('Could not send the request. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="space-y-4 text-sm leading-6 text-map-ink">
      <h1 className="text-2xl font-semibold">Forgot password</h1>
      <p className="text-map-muted">
        Enter your email. If an account exists, we send a reset link. The message is the same either
        way so accounts cannot be guessed.
      </p>
      {done ? (
        <p className="rounded-map-card border border-map-border bg-map-surface px-4 py-3">
          If that email is registered, a reset link is on its way. Check your inbox.
        </p>
      ) : (
        <form className="max-w-sm space-y-3" onSubmit={(event) => void onSubmit(event)}>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-map-muted">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2"
            />
          </label>
          {error ? <p className="text-map-error">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-map-control bg-map-primary px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p>
        <Link to="/" className="text-map-primary underline">
          Back to the map
        </Link>
      </p>
    </article>
  );
}
