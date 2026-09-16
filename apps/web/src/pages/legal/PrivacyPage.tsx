import { Link } from 'react-router-dom';

export default function PrivacyPage() {
  return (
    <article className="prose-legal space-y-4 text-sm leading-6 text-map-ink">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p className="text-map-muted">Last updated: 16 September 2026</p>
      <p>
        CoreMap is a Myanmar map. This page explains what account data we collect when you create
        or use a CoreMap account on this map. It is not a company-registration statement.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Account data we collect</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Email address</li>
        <li>Display name and optional profile fields such as phone and preferred language</li>
        <li>
          Google or Facebook identity information if you choose to sign in with those providers
          (provider account id, and email or name when the provider shares them)
        </li>
        <li>
          Session and security metadata: login times, hashed refresh tokens, browser/user-agent,
          and approximate IP used to protect the account
        </li>
        <li>Saved places, if you use that feature</li>
        <li>Reports and contributions you submit through the map</li>
      </ul>
      <p>
        You can browse the public map without an account. We do not operate a live-location sharing
        product today, so this policy does not cover always-on location sharing.
      </p>

      <h2 className="pt-2 text-lg font-semibold">How we use it</h2>
      <p>
        We use this data to run your account, keep you signed in, send verification or security
        emails, review map reports, and protect the service from abuse. We do not sell account data.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Retention and deletion</h2>
      <p>
        Account profile data is kept while the account is active. You can request deletion from the{' '}
        <Link to="/account-deletion" className="text-map-primary underline">
          account deletion
        </Link>{' '}
        page. After deletion we revoke sessions and remove or anonymize personal profile data.
        Accepted map reports may remain in anonymized form so the map stays accurate.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Contact</h2>
      <p>
        Account, support, and privacy:{' '}
        <a className="text-map-primary underline" href="mailto:support@coremapmm.com">
          support@coremapmm.com
        </a>
      </p>
      <p>
        Security issues:{' '}
        <a className="text-map-primary underline" href="mailto:security@coremapmm.com">
          security@coremapmm.com
        </a>
      </p>
    </article>
  );
}
