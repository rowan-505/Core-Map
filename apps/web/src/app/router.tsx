import { createBrowserRouter } from 'react-router-dom';
import RootLayout from './layouts/RootLayout';
import HomePage from '../pages/HomePage';
import ShareResolver from '@/features/share/components/ShareResolver';
import LegalLayout from '../pages/legal/LegalLayout';
import PrivacyPage from '../pages/legal/PrivacyPage';
import TermsPage from '../pages/legal/TermsPage';
import ContactPage from '../pages/legal/ContactPage';
import AccountDeletionPage from '../pages/legal/AccountDeletionPage';
import ForgotPasswordPage from '../pages/legal/ForgotPasswordPage';
import ResetPasswordPage from '../pages/legal/ResetPasswordPage';
import OAuthResultPage from '../pages/legal/OAuthResultPage';
import CompleteProfilePage from '../pages/legal/CompleteProfilePage';
import AccountSecurityPage from '../pages/account/AccountSecurityPage';
import NotFoundPage from '../pages/NotFoundPage';
import RouteErrorPage from '../pages/RouteErrorPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 's/:code', element: <ShareResolver /> },
    ],
  },
  {
    element: <LegalLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'terms', element: <TermsPage /> },
      { path: 'contact', element: <ContactPage /> },
      { path: 'account-deletion', element: <AccountDeletionPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'auth/callback', element: <OAuthResultPage /> },
      { path: 'auth/complete-profile', element: <CompleteProfilePage /> },
      { path: 'account/security', element: <AccountSecurityPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
