import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { RegionCombobox } from '@/features/regions/components/RegionCombobox';
import { LegalFooter } from '@/pages/legal/LegalLayout';
import { ApiError, getApiBaseUrl } from '../api/http';
import { useAuth } from '../state/useAuth';
import type { AuthModalView } from '../state/useAuth';
import type { PreferredLanguage } from '../types';
import { useOAuthProviders } from '../hooks/useOAuthProviders';

/**
 * Sign-in / sign-up form rendered inside the left drawer (not a centered modal).
 * On success the AuthContext user updates and the account panel swaps to the
 * profile view automatically — the rest of the map stays visible and usable.
 */
export function AuthDrawerPanel({
  initialView = 'login',
}: {
  readonly initialView?: AuthModalView;
}) {
  const t = useMapUiText();
  const { login, register } = useAuth();
  const oauthProviders = useOAuthProviders();
  const [view, setView] = useState<AuthModalView>(initialView);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<PreferredLanguage>('my');
  const [regionId, setRegionId] = useState<string | null>(null);
  const [regionLabel, setRegionLabel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = view === 'signup';

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (isSignup && password !== confirmPassword) {
      setError(t('စကားဝှက်နှစ်ခု မတူပါ။', 'Passwords do not match.'));
      return;
    }
    setSubmitting(true);
    try {
      if (isSignup) {
        await register({
          email: email.trim(),
          displayName: displayName.trim(),
          password,
          preferredLanguage,
          primaryRegionId: regionId === null ? null : Number.parseInt(regionId, 10),
        });
      } else {
        await login({ email: email.trim(), password });
      }
      // No manual close: the account panel reacts to the new auth state.
    } catch (err) {
      setError(toErrorMessage(err, isSignup, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="p-3.5 text-sm">
      <div className="rounded-map-card border border-map-border bg-map-surface p-4 shadow-map-card">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-blue-100/55 p-1 text-sm font-semibold">
          <button
            type="button"
            className={tabClass(!isSignup)}
            aria-pressed={!isSignup}
            onClick={() => {
              setView('login');
              setError(null);
            }}
          >
            {t('အကောင့်ဝင်ရန်', 'Sign in')}
          </button>
          <button
            type="button"
            className={tabClass(isSignup)}
            aria-pressed={isSignup}
            onClick={() => {
              setView('signup');
              setError(null);
            }}
          >
            {t('အကောင့်ဖွင့်ရန်', 'Sign up')}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {oauthProviders.google ? (
            <OAuthButton provider="google" label={t('Google ဖြင့် ဆက်လုပ်ရန်', 'Continue with Google')} />
          ) : null}
          {oauthProviders.facebook ? (
            <OAuthButton provider="facebook" label={t('Facebook ဖြင့် ဆက်လုပ်ရန်', 'Continue with Facebook')} />
          ) : null}
          {oauthProviders.google || oauthProviders.facebook ? (
            <div className="flex items-center gap-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-map-muted">
              <span className="h-px flex-1 bg-map-border" />
              {t('သို့မဟုတ်', 'or')}
              <span className="h-px flex-1 bg-map-border" />
            </div>
          ) : null}
        </div>

        <form className="mt-1 space-y-3" onSubmit={onSubmit}>
          {isSignup ? (
            <Field
              label={t('အသုံးပြုသူအမည်', 'Display name')}
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={setDisplayName}
              placeholder={t('သင့်အမည်', 'Your name')}
              required
              minLength={2}
            />
          ) : null}
          <Field
            label={t('အီးမေးလ်', 'Email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            required
          />
          <Field
            label={t('စကားဝှက်', 'Password')}
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChange={setPassword}
            placeholder={
              isSignup
                ? t('အနည်းဆုံး စာလုံး ၈ လုံး', 'At least 8 characters')
                : t('သင့်စကားဝှက်', 'Your password')
            }
            required
            minLength={isSignup ? 8 : 8}
          />
          {isSignup ? (
            <Field
              label={t('စကားဝှက် အတည်ပြုရန်', 'Confirm password')}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              required
              minLength={8}
            />
          ) : (
            <p className="text-right text-xs">
              <Link to="/forgot-password" className="text-map-primary hover:underline">
                {t('စကားဝှက် မေ့နေပါသလား။', 'Forgot password?')}
              </Link>
            </p>
          )}
          {isSignup ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-map-muted">
                {t('နှစ်သက်ရာဘာသာစကား', 'Preferred language')}
              </span>
              <select
                className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm text-map-ink outline-none transition-colors focus:border-map-primary "
                value={preferredLanguage}
                onChange={(event) =>
                  setPreferredLanguage(event.target.value === 'en' ? 'en' : 'my')
                }
              >
                <option value="my">မြန်မာ (Myanmar)</option>
                <option value="en">English</option>
              </select>
            </label>
          ) : null}
          {isSignup ? (
            <RegionCombobox
              label={t('အဓိကဒေသ', 'Primary region')}
              value={regionId}
              selectedLabel={regionLabel}
              onChange={(id, displayName) => {
                setRegionId(id);
                setRegionLabel(displayName);
              }}
            />
          ) : null}

          {error ? (
            <p
              className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-map-control bg-map-primary px-4 py-2.5 text-sm font-semibold text-white shadow-map-control transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:bg-map-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
          >
            {submitting
              ? t('ခဏစောင့်ပါ…', 'Please wait…')
              : isSignup
                ? t('အကောင့်ဖွင့်ရန်', 'Create account')
                : t('အကောင့်ဝင်ရန်', 'Sign in')}
          </button>
        </form>
      </div>

      <p className="mt-3 px-1 text-center text-xs text-map-muted">
        {t(
          'နေရာသိမ်းရန်သာ အကောင့်လိုသည်။',
          'Sign in only to save places.',
        )}
      </p>
      <div className="mt-3 flex justify-center">
        <LegalFooter />
      </div>
    </section>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required = false,
  minLength,
}: {
  readonly label: string;
  readonly type: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly required?: boolean;
  readonly minLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-map-muted">{label}</span>
      <input
        className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm text-map-ink outline-none transition-colors focus:border-map-primary "
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
      />
    </label>
  );
}

function tabClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 transition-colors ${
    active
      ? 'bg-map-primary text-white shadow-map-control'
      : 'text-map-muted hover:bg-white/70 hover:text-map-primary'
  }`;
}

function toErrorMessage(
  error: unknown,
  isSignup: boolean,
  t: (myanmar: string, english: string) => string,
): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return t('ဤအီးမေးလ်ကို အသုံးပြုပြီးဖြစ်သည်။', 'Email already in use.');
    }
    if (error.status === 401) {
      return t('အီးမေးလ် သို့မဟုတ် စကားဝှက် မမှန်ပါ။', 'Incorrect email or password.');
    }
    if (error.message) return error.message;
  }
  return isSignup
    ? t('အကောင့်ဖွင့်၍မရပါ။', 'Could not create account.')
    : t('အကောင့်ဝင်၍မရပါ။', 'Could not sign in.');
}

function OAuthButton({
  provider,
  label,
}: {
  readonly provider: 'google' | 'facebook';
  readonly label: string;
}) {
  return (
    <a
      href={`${getApiBaseUrl()}/auth/oauth/${provider}/start?client=web`}
      className="flex w-full items-center justify-center rounded-map-control border border-map-border bg-map-surface px-4 py-2 text-sm font-semibold text-map-ink hover:bg-map-primary-soft"
    >
      {label}
    </a>
  );
}
