import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';

export default function RouteErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-map-bg px-4 py-10 text-map-ink">
      <section className="w-full max-w-md rounded-3xl border border-map-border bg-map-surface p-6 text-center shadow-map-card sm:p-8">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-map-primary-soft text-lg font-bold text-map-primary">
          {notFound ? '404' : '!'}
        </div>
        <h1 className="mt-5 text-2xl font-semibold">
          {notFound ? 'Page not found' : 'CoreMap could not open this page'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-map-muted">
          {notFound
            ? 'Check the link or return to the map.'
            : 'Your data is safe. Reload this page or return to the map and try again.'}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          {!notFound ? (
            <button
              type="button"
              className="min-h-11 rounded-map-control border border-map-border bg-white px-4 py-2.5 font-semibold text-map-ink hover:border-map-primary/40"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          ) : null}
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center rounded-map-control bg-map-primary px-4 py-2.5 font-semibold text-white hover:bg-map-primary-hover"
          >
            Back to map
          </Link>
        </div>
      </section>
    </main>
  );
}
