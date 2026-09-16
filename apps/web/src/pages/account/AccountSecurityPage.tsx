import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authJson, getApiBaseUrl, publicJson } from '@/features/auth/api/http';
import {
  clearConnectProviderIntent,
  peekConnectProviderIntent,
} from '@/features/auth/lib/connectProviderIntent';
import { useAuth } from '@/features/auth/state/useAuth';

type SessionRow = {
  public_id: string;
  current: boolean;
  created_at: string;
  last_used_at: string | null;
  user_agent: string | null;
  device_label: string;
};

type EventRow = {
  event_type: string;
  success: boolean;
  provider: string | null;
  created_at: string;
  ip_address: string | null;
};

type ProviderStatus = {
  provider: 'google' | 'facebook';
  connected: boolean;
  provider_email: string | null;
  linked_at: string | null;
  last_login_at: string | null;
};

type IdentitiesResponse = {
  providers: ProviderStatus[];
  has_password: boolean;
  can_unlink: Record<'google' | 'facebook', boolean>;
  facebook_available?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPrivilegedRoles(roles: readonly string[]): boolean {
  return roles.some((role) => role === 'admin' || role === 'super_admin');
}

function formatWhen(value: string | null): string {
  if (!value) return 'Unknown';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function AccountSecurityPage() {
  const { user, isAuthenticated, initializing, logout } = useAuth();
  const [params] = useSearchParams();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [identities, setIdentities] = useState<IdentitiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const reload = async () => {
    const [sessionBody, eventBody, identityBody] = await Promise.all([
      authJson<{ sessions: SessionRow[] }>('/auth/sessions'),
      authJson<{ events: EventRow[] }>('/auth/security-events'),
      authJson<IdentitiesResponse>('/auth/identities'),
    ]);
    setSessions(sessionBody.sessions);
    setEvents(eventBody.events);
    setIdentities(identityBody);
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    void reload().catch(() => setError('Could not load security details.'));
  }, [isAuthenticated]);

  useEffect(() => {
    const linked = params.get('linked');
    if (linked === 'google' || linked === 'facebook') {
      setBanner(
        `${linked === 'google' ? 'Google' : 'Facebook'} is connected to your CoreMap account.`,
      );
      clearConnectProviderIntent();
    } else if (isAuthenticated && peekConnectProviderIntent()) {
      setBanner('You can connect Google below. Choose Connect to continue.');
    }
  }, [params, isAuthenticated]);

  if (initializing) {
    return <p className="text-sm text-map-muted">Loading…</p>;
  }

  if (!isAuthenticated || !user) {
    return (
      <article className="space-y-3 text-sm">
        <h1 className="text-2xl font-semibold">Account security</h1>
        <p>Sign in on the map first, then return here to manage sessions, password, and connected accounts.</p>
        <Link to="/" className="text-map-primary underline">
          Back to the map
        </Link>
      </article>
    );
  }

  return (
    <article className="space-y-8 text-sm leading-6 text-map-ink">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Account security</h1>
        <p className="text-map-muted">
          {user.email}
          {user.email_verified ? ' · verified' : ' · email not verified'}
        </p>
      </header>
      {banner ? <p className="rounded-map-card border border-map-border bg-map-surface px-3 py-2">{banner}</p> : null}
      {error ? <p className="text-map-error">{error}</p> : null}

      <ConnectedAccountsPanel
        identities={identities}
        onChanged={() => void reload().catch(() => setError('Could not refresh connected accounts.'))}
      />

      <PasswordSection
        email={user.email}
        hasPassword={identities?.has_password ?? false}
        identitiesLoaded={identities !== null}
        privileged={isPrivilegedRoles(user.roles)}
      />

      <ChangeEmailForm hasPassword={identities?.has_password ?? false} />

      <SessionsPanel
        sessions={sessions}
        onChanged={() => void reload().catch(() => setError('Could not refresh sessions.'))}
      />

      <EventsPanel events={events} />

      <section className="space-y-3 border-t border-map-border pt-6">
        <h2 className="text-lg font-semibold text-red-700">Danger zone</h2>
        <DeleteAccountForm
          hasPassword={identities?.has_password ?? false}
          onDeleted={() => void logout()}
        />
      </section>

      <Link to="/" className="text-map-primary underline">
        Back to the map
      </Link>
    </article>
  );
}

function ConnectedAccountsPanel({
  identities,
  onChanged,
}: {
  identities: IdentitiesResponse | null;
  onChanged: () => void;
}) {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const startLink = (provider: 'google' | 'facebook') => {
    const returnTo = `${window.location.origin}/account/security`;
    window.location.href = `${getApiBaseUrl()}/auth/oauth/${provider}/link?return_to=${encodeURIComponent(returnTo)}`;
  };

  const unlink = async (provider: 'google' | 'facebook') => {
    try {
      await authJson(`/auth/identities/${provider}`, {
        method: 'DELETE',
        body: identities?.has_password ? { password } : {},
      });
      setPassword('');
      setMessage(`${provider === 'google' ? 'Google' : 'Facebook'} disconnected.`);
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not disconnect provider.');
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Connected accounts</h2>
      <p className="text-map-muted">
        Linking uses the provider account itself, not email matching.
      </p>
      {(identities?.providers ?? [
        { provider: 'google' as const, connected: false, provider_email: null, linked_at: null, last_login_at: null },
      ]).map((row) => {
        const label = row.provider === 'google' ? 'Google' : 'Facebook';
        const canUnlink = identities?.can_unlink[row.provider] ?? false;
        const canConnect =
          row.provider === 'google' || Boolean(identities?.facebook_available);
        return (
          <div key={row.provider} className="rounded-map-card border border-map-border px-3 py-3">
            <p className="font-medium">
              {label} · {row.connected ? 'Connected' : 'Not connected'}
            </p>
            {row.connected && row.provider_email ? (
              <p className="text-xs text-map-muted">{row.provider_email}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {row.connected ? (
                <button
                  type="button"
                  disabled={!canUnlink}
                  className="rounded-map-control border border-map-border px-3 py-1.5 disabled:opacity-50"
                  onClick={() => void unlink(row.provider)}
                >
                  Disconnect {label}
                </button>
              ) : canConnect ? (
                <button
                  type="button"
                  className="rounded-map-control bg-map-primary px-3 py-1.5 font-semibold text-white"
                  onClick={() => startLink(row.provider)}
                >
                  Connect {label}
                </button>
              ) : null}
            </div>
            {row.connected && !canUnlink ? (
              <p className="mt-1 text-xs text-map-muted">
                Keep at least one sign-in method before disconnecting this one.
              </p>
            ) : null}
          </div>
        );
      })}
      {identities?.has_password ? (
        <input
          type="password"
          placeholder="Password required to disconnect"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="max-w-sm w-full rounded-map-control border border-map-border px-3 py-2"
        />
      ) : null}
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function PasswordSection({
  email,
  hasPassword,
  identitiesLoaded,
  privileged,
}: {
  email: string;
  hasPassword: boolean;
  identitiesLoaded: boolean;
  privileged: boolean;
}) {
  if (!identitiesLoaded) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Password</h2>
        <p className="text-map-muted">Loading…</p>
      </section>
    );
  }
  if (!hasPassword) {
    return <SetPasswordViaEmail email={email} />;
  }
  return <ChangePasswordForm privileged={privileged} />;
}

function SetPasswordViaEmail({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onSend = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await publicJson('/auth/password/forgot', { email });
      setMessage(
        'If that email can receive mail, a set-password link is on its way. Open it, choose a password, then return here.',
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not send the link. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Set a password</h2>
      <p className="text-map-muted">
        This account has no password yet. We email a one-time link to{' '}
        <span className="text-map-ink">{email}</span>.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onSend()}
        className="rounded-map-control bg-map-primary px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Email me a set-password link'}
      </button>
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function ChangePasswordForm({ privileged }: { privileged: boolean }) {
  const minLength = privileged ? 12 : 8;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setMessage(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setFieldError('Fill in all password fields.');
      return;
    }
    if (newPassword.trim().length === 0) {
      setFieldError('Password cannot be only whitespace.');
      return;
    }
    if (newPassword.length < minLength) {
      setFieldError(`New password must be at least ${minLength} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setFieldError('New password must be different from the current password.');
      return;
    }

    setBusy(true);
    try {
      await authJson('/auth/password/change', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Password updated. Other devices were signed out.');
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Password</h2>
      <p className="text-map-muted">
        {privileged
          ? 'Admin accounts need at least 12 characters.'
          : 'Use at least 8 characters.'}
      </p>
      <form className="max-w-sm space-y-2" onSubmit={(event) => void onSubmit(event)}>
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className="w-full rounded-map-control border border-map-border px-3 py-2"
        />
        <input
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          placeholder={`New password (min ${minLength})`}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className="w-full rounded-map-control border border-map-border px-3 py-2"
        />
        <input
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full rounded-map-control border border-map-border px-3 py-2"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-map-control bg-map-primary px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
      {fieldError ? <p className="text-map-error">{fieldError}</p> : null}
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function ChangeEmailForm({ hasPassword }: { hasPassword: boolean }) {
  const [password, setPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'form' | 'code'>('form');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!hasPassword) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Email</h2>
        <p className="text-map-muted">Set a password first, then you can change the account email.</p>
      </section>
    );
  }

  const onStart = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const trimmed = newEmail.trim();
    if (!EMAIL_RE.test(trimmed) || /^\d+$/.test(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Current password is required.');
      return;
    }
    setBusy(true);
    try {
      const result = await authJson<{ status?: string }>('/auth/email/change', {
        method: 'POST',
        body: { password, newEmail: trimmed },
      });
      if (result?.status !== 'sent') {
        setError('Could not start email change.');
        return;
      }
      setStage('code');
      setMessage(`We sent a 6-digit code to ${trimmed}. Enter it below to finish.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start email change.');
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    try {
      await authJson('/auth/email/change/confirm', {
        method: 'POST',
        body: { code: code.trim() },
      });
      setPassword('');
      setNewEmail('');
      setCode('');
      setStage('form');
      setMessage('Email updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Email</h2>
      {stage === 'form' ? (
        <form className="max-w-sm space-y-2" onSubmit={(event) => void onStart(event)}>
          <input
            type="password"
            required
            placeholder="Current password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-map-control border border-map-border px-3 py-2"
          />
          <input
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            placeholder="New email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            className="w-full rounded-map-control border border-map-border px-3 py-2"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-map-control bg-map-primary px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Send verification code'}
          </button>
        </form>
      ) : (
        <form className="max-w-sm space-y-2" onSubmit={(event) => void onConfirm(event)}>
          <input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code"
            className="w-full rounded-map-control border border-map-border px-3 py-2"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-map-control bg-map-primary px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Confirming…' : 'Confirm email'}
          </button>
          <button
            type="button"
            className="text-map-primary underline"
            onClick={() => {
              setStage('form');
              setCode('');
              setError(null);
              setMessage(null);
            }}
          >
            Cancel
          </button>
        </form>
      )}
      {error ? <p className="text-map-error">{error}</p> : null}
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function SessionsPanel({
  sessions,
  onChanged,
}: {
  sessions: SessionRow[];
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const current = sessions.find((session) => session.current) ?? null;
  const others = sessions.filter((session) => !session.current);
  const visibleOthers = expanded ? others : others.slice(0, 5);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Active sessions</h2>
      <p className="text-map-muted">
        Each row is one login on a device. Refreshing your access token does not create a new row.
      </p>

      {current ? (
        <div className="rounded-map-card border border-map-border px-3 py-3">
          <p className="font-medium">This device · {current.device_label}</p>
          <p className="text-xs text-map-muted">Last active {formatWhen(current.last_used_at)}</p>
        </div>
      ) : (
        <p className="text-map-muted">Current device session not found. Sign in again if needed.</p>
      )}

      {others.length > 0 ? (
        <div className="space-y-2">
          <p className="font-medium">Other devices</p>
          <ul className="space-y-2">
            {visibleOthers.map((session) => (
              <li key={session.public_id} className="rounded-map-card border border-map-border px-3 py-2">
                <p className="font-medium">{session.device_label}</p>
                <p className="text-xs text-map-muted">Last active {formatWhen(session.last_used_at)}</p>
                <button
                  type="button"
                  className="mt-1 text-map-primary underline"
                  onClick={() => {
                    void authJson(`/auth/sessions/${session.public_id}`, { method: 'DELETE' }).then(
                      onChanged,
                    );
                  }}
                >
                  Sign out
                </button>
              </li>
            ))}
          </ul>
          {others.length > 5 ? (
            <button
              type="button"
              className="text-map-primary underline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Show less' : `Show more (${others.length - 5} more)`}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-map-control border border-map-border px-3 py-1.5"
            onClick={() => {
              void authJson('/auth/sessions/revoke-others', { method: 'POST', body: {} }).then(
                onChanged,
              );
            }}
          >
            Sign out all other devices
          </button>
        </div>
      ) : (
        <p className="text-map-muted">No other active devices.</p>
      )}
    </section>
  );
}

function EventsPanel({ events }: { events: EventRow[] }) {
  const recent = useMemo(() => events.slice(0, 10), [events]);
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Recent activity</h2>
      {recent.length === 0 ? (
        <p className="text-map-muted">No recent security events.</p>
      ) : (
        <ul className="space-y-1 text-xs text-map-muted">
          {recent.map((event) => (
            <li key={`${event.event_type}-${event.created_at}`}>
              {formatWhen(event.created_at)}: {event.event_type}
              {event.success ? '' : ' (failed)'}
              {event.provider ? ` via ${event.provider}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeleteAccountForm({
  hasPassword,
  onDeleted,
}: {
  hasPassword: boolean;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  if (!hasPassword) {
    return (
      <p className="text-map-muted">
        Set a password first, then you can confirm account deletion with that password.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-map-muted">
        This signs you out and anonymizes your profile. Accepted reports stay on the map without your
        name.
      </p>
      <form
        className="max-w-sm space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void authJson('/auth/account/delete', {
            method: 'POST',
            body: { password, confirm },
          })
            .then(onDeleted)
            .catch((err) => setMessage(err instanceof Error ? err.message : 'Could not delete account.'));
        }}
      >
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-map-control border border-map-border px-3 py-2"
        />
        <input
          required
          placeholder="Type DELETE"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className="w-full rounded-map-control border border-map-border px-3 py-2"
        />
        <button type="submit" className="rounded-map-control border border-red-300 px-4 py-2 text-red-700">
          Delete account
        </button>
      </form>
      {message ? <p className="text-map-error">{message}</p> : null}
    </div>
  );
}
