import { useState } from 'react';
import { ApiError } from '../api/http';
import { useAuth } from '../state/useAuth';
import { useMapUiText } from '@/features/map/i18n/mapUiText';

type Phase = 'idle' | 'code';

/** Inline email verification: send OTP, enter the 6-digit code, update badge. */
export function EmailVerifySection() {
  const t = useMapUiText();
  const { sendEmailOtp, verifyEmailOtp } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSend = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const status = await sendEmailOtp();
      if (status === 'already_verified') {
        setMessage(t('အီးမေးလ် အတည်ပြုပြီးပါပြီ။', 'Your email is already verified.'));
        return;
      }
      setPhase('code');
      setMessage(t('ဂဏန်း ၆ လုံးပါ ကုဒ်ကို အီးမေးလ်သို့ ပို့ပြီးပါပြီ။', 'We sent a 6-digit code to your email.'));
    } catch (err) {
      setError(toMessage(err, t('ကုဒ်ပို့၍ မရပါ။ ထပ်ကြိုးစားပါ။', 'Could not send the code. Try again.')));
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const status = await verifyEmailOtp(code.trim());
      if (status === 'verified' || status === 'already_verified') {
        setMessage(t('အီးမေးလ် အတည်ပြုပြီးပါပြီ။', 'Email verified.'));
        setPhase('idle');
        setCode('');
      }
    } catch (err) {
      setError(toMessage(err, t('ကုဒ်မှားနေသည် သို့မဟုတ် သက်တမ်းကုန်သွားပါပြီ။', 'Invalid or expired code.')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-map-muted">{t('အီးမေးလ် အတည်ပြုရန်', 'Verify your email')}</p>

      {phase === 'idle' ? (
        <button
          type="button"
          className="w-full rounded-map-control bg-map-primary px-4 py-2 text-sm font-semibold text-white shadow-map-control transition-colors hover:bg-map-primary-hover disabled:opacity-60"
          disabled={busy}
          onClick={() => void onSend()}
        >
          {busy ? t('ပို့နေသည်…', 'Sending…') : t('အတည်ပြုကုဒ် ပို့ရန်', 'Send verification code')}
        </button>
      ) : (
        <div className="space-y-2">
          <input
            className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-center text-base font-semibold tracking-[0.4em] text-map-ink outline-none focus:border-map-primary "
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-map-control bg-map-primary px-4 py-2 text-sm font-semibold text-white shadow-map-control transition-colors hover:bg-map-primary-hover disabled:opacity-60"
              disabled={busy || code.length !== 6}
              onClick={() => void onVerify()}
            >
              {busy ? t('စစ်နေသည်…', 'Verifying…') : t('အတည်ပြုရန်', 'Verify')}
            </button>
            <button
              type="button"
              className="rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm font-semibold text-map-muted transition-colors hover:bg-map-primary-soft hover:text-map-primary disabled:opacity-60"
              disabled={busy}
              onClick={() => void onSend()}
            >
              {t('ပြန်ပို့ရန်', 'Resend')}
            </button>
          </div>
        </div>
      )}

      {message ? <p className="text-xs text-emerald-600">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}
