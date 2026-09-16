import { Link } from 'react-router-dom';

export default function AccountDeletionPage() {
  return (
    <article className="space-y-4 text-sm leading-6 text-map-ink">
      <h1 className="text-2xl font-semibold">Account deletion</h1>
      <p>
        You can delete your CoreMap account from Account → Security after you sign in. We ask you to
        confirm and re-enter your password (or complete a recent sign-in check).
      </p>
      <h2 className="pt-2 text-lg font-semibold">What happens</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>All of your sign-in sessions are revoked.</li>
        <li>You cannot sign in with that account again.</li>
        <li>Personal profile data such as display name and email is removed or anonymized.</li>
        <li>
          Saved places tied only to you are removed. Accepted map reports or contributions may stay
          on the map in anonymized form so public map data remains usable.
        </li>
      </ul>
      <p>
        If you cannot sign in, email{' '}
        <a className="text-map-primary underline" href="mailto:support@coremapmm.com">
          support@coremapmm.com
        </a>{' '}
        from the address on the account.
      </p>
      <p>
        <Link to="/" className="text-map-primary underline">
          Return to the map
        </Link>
      </p>
    </article>
  );
}
