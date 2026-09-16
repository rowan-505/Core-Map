import { useEffect, useState } from 'react';
import { publicGet } from '../api/http';

export type OAuthProviderCapabilities = {
  google: boolean;
  facebook: boolean;
};

const DEFAULT_CAPABILITIES: OAuthProviderCapabilities = {
  google: true,
  facebook: false,
};

/**
 * Load which OAuth providers the API currently exposes.
 * Facebook is off for the current production release unless the API enables it.
 */
export function useOAuthProviders(): OAuthProviderCapabilities {
  const [providers, setProviders] = useState<OAuthProviderCapabilities>(DEFAULT_CAPABILITIES);

  useEffect(() => {
    let cancelled = false;
    void publicGet<{ providers: OAuthProviderCapabilities }>('/auth/providers')
      .then((body) => {
        if (cancelled || !body?.providers) return;
        setProviders({
          google: Boolean(body.providers.google),
          facebook: Boolean(body.providers.facebook),
        });
      })
      .catch(() => {
        // Keep conservative defaults (Google may still work via direct link).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return providers;
}
