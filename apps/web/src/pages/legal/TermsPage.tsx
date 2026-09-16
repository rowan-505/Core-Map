import { Link } from 'react-router-dom';

export default function TermsPage() {
  return (
    <article className="space-y-4 text-sm leading-6 text-map-ink">
      <h1 className="text-2xl font-semibold">Terms</h1>
      <p className="text-map-muted">Last updated: 16 September 2026</p>
      <p>
        These terms apply when you create a CoreMap account or use signed-in features on the public
        map. Browsing the map without an account is allowed.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Your account</h2>
      <p>
        You are responsible for the email, password, and devices used to sign in. Do not share your
        password. Tell us if you think someone else is using your account.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Acceptable use</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Do not attack, scrape in a harmful way, or try to break the service.</li>
        <li>Do not impersonate others or submit false account information.</li>
        <li>Do not use the map to harass people or to publish illegal content.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold">Map accuracy</h2>
      <p>
        CoreMap aims to be useful, especially in Myanmar. Map data can be incomplete, unofficial, or
        out of date. Do not treat it as a legal survey, emergency service, or guarantee of road
        conditions.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Reports and contributions</h2>
      <p>
        If you send a report or contribution, keep it factual and relevant to the map. We may review,
        edit, reject, or keep accepted map corrections so public data stays consistent. Abuse or spam
        can lead to limits or account action.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Suspension and deletion</h2>
      <p>
        We may disable an account that breaks these terms or harms the service. You may request
        deletion as described on the{' '}
        <Link to="/account-deletion" className="text-map-primary underline">
          account deletion
        </Link>{' '}
        page.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Contact</h2>
      <p>
        Support:{' '}
        <a className="text-map-primary underline" href="mailto:support@coremapmm.com">
          support@coremapmm.com
        </a>
      </p>
    </article>
  );
}
