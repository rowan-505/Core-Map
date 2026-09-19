import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[radial-gradient(circle_at_top_left,rgba(15,104,232,0.14),transparent_34rem),var(--color-map-bg)] px-4 py-10 text-map-ink">
      <section className="w-full max-w-md rounded-3xl border border-white/90 bg-map-surface p-6 text-center shadow-map-float sm:p-8">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-map-primary-soft text-lg font-bold text-map-primary">
          404
        </div>
        <h1 className="mt-5 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-map-muted">
          This link may be old or incorrect. Return to CoreMap to continue exploring Myanmar.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-map-control bg-map-primary px-5 py-2.5 font-semibold text-white shadow-map-control hover:bg-map-primary-hover"
        >
          Back to map
        </Link>
      </section>
    </main>
  );
}
