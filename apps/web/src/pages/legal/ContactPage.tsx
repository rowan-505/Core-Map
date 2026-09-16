export default function ContactPage() {
  return (
    <article className="space-y-4 text-sm leading-6 text-map-ink">
      <h1 className="text-2xl font-semibold">Contact</h1>
      <p>Use these addresses. Please do not send passwords or one-time codes by email.</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <a className="font-medium text-map-primary underline" href="mailto:support@coremapmm.com">
            support@coremapmm.com
          </a>
          <span className="block text-map-muted">Account help, support, and privacy questions.</span>
        </li>
        <li>
          <a className="font-medium text-map-primary underline" href="mailto:security@coremapmm.com">
            security@coremapmm.com
          </a>
          <span className="block text-map-muted">Security reports only.</span>
        </li>
      </ul>
    </article>
  );
}
