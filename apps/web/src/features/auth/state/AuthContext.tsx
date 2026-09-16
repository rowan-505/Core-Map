import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchProfile,
  login as loginRequest,
  logout as logoutRequest,
  registerAccount,
  sendEmailOtp as sendEmailOtpRequest,
  updateProfile as updateProfileRequest,
  verifyEmailOtp as verifyEmailOtpRequest,
} from '../api/authApi';
import { onSessionCleared, refreshAccessToken } from '../api/http';
import { clearConnectProviderIntent, peekConnectProviderIntent } from '../lib/connectProviderIntent';
import { clearTokens, setAccessToken } from '../lib/tokenStorage';
import type {
  AuthProfile,
  EmailOtpStatus,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from '../types';
import {
  AuthContext,
  type AuthContextValue,
  type AuthModalView,
} from './useAuth';

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [user, setUser] = useState<AuthProfile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authModalView, setAuthModalView] = useState<AuthModalView | null>(null);
  const mounted = useRef(true);

  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    try {
      const profile = await fetchProfile(signal);
      if (mounted.current) setUser(profile);
    } catch {
      clearTokens();
      if (mounted.current) setUser(null);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();

    const bootstrap = async () => {
      const token = await refreshAccessToken();
      if (token && mounted.current) {
        await loadProfile(controller.signal);
      }
      if (mounted.current) setInitializing(false);
    };
    void bootstrap();

    const unsubscribe = onSessionCleared(() => {
      if (mounted.current) setUser(null);
    });

    return () => {
      mounted.current = false;
      controller.abort();
      unsubscribe();
    };
  }, [loadProfile]);

  const login = useCallback(
    async (input: LoginInput) => {
      const session = await loginRequest(input);
      if (!session.accessToken) {
        throw new Error('Could not sign in.');
      }
      setAccessToken(session.accessToken);
      await loadProfile();
      if (peekConnectProviderIntent()) {
        // Guide to Security; user still must click Connect (no auto-start).
        window.location.assign('/account/security');
        return;
      }
      clearConnectProviderIntent();
    },
    [loadProfile],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      await registerAccount(input);
      await login({ email: input.email, password: input.password });
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Best-effort server revoke; always clear locally below.
    }
    clearTokens();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  const updateProfile = useCallback(async (input: UpdateProfileInput) => {
    const updated = await updateProfileRequest(input);
    if (mounted.current) setUser(updated);
  }, []);

  const sendEmailOtp = useCallback(async (): Promise<EmailOtpStatus> => {
    const result = await sendEmailOtpRequest();
    if (result.status === 'already_verified') {
      await loadProfile();
    }
    return result.status;
  }, [loadProfile]);

  const verifyEmailOtp = useCallback(
    async (code: string): Promise<EmailOtpStatus> => {
      const result = await verifyEmailOtpRequest(code);
      if (result.status === 'verified' || result.status === 'already_verified') {
        await loadProfile();
      }
      return result.status;
    },
    [loadProfile],
  );

  const openAuthModal = useCallback((view: AuthModalView = 'login') => {
    setAuthModalView(view);
  }, []);

  const closeAuthModal = useCallback(() => setAuthModalView(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      initializing,
      login,
      register,
      logout,
      refreshProfile,
      updateProfile,
      sendEmailOtp,
      verifyEmailOtp,
      authModalView,
      openAuthModal,
      closeAuthModal,
    }),
    [
      user,
      initializing,
      login,
      register,
      logout,
      refreshProfile,
      updateProfile,
      sendEmailOtp,
      verifyEmailOtp,
      authModalView,
      openAuthModal,
      closeAuthModal,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
