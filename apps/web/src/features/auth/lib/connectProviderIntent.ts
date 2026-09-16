const CONNECT_PROVIDER_KEY = 'coremap_connect_provider';

export type ConnectProviderIntent = 'google' | 'facebook' | 'pending';

export function setConnectProviderIntent(provider: ConnectProviderIntent): void {
  try {
    sessionStorage.setItem(CONNECT_PROVIDER_KEY, provider);
  } catch {
    // sessionStorage may be unavailable
  }
}

export function peekConnectProviderIntent(): ConnectProviderIntent | null {
  try {
    const value = sessionStorage.getItem(CONNECT_PROVIDER_KEY);
    if (value === 'google' || value === 'facebook' || value === 'pending') return value;
  } catch {
    // ignore
  }
  return null;
}

export function clearConnectProviderIntent(): void {
  try {
    sessionStorage.removeItem(CONNECT_PROVIDER_KEY);
  } catch {
    // ignore
  }
}
