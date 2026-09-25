import { isRouteErrorResponse, useRouteError } from "react-router";
import { Preloader } from "./Preloader";

/** Friendly error page for any route (instead of React Router's developer default). */
export function RouteError() {
  const error = useRouteError();
  // After a deploy, an open tab may request code chunks that no longer exist.
  const staleBuild = error instanceof Error && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (!staleBuild && !notFound) console.error(error);
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-center">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold text-ink">{staleBuild ? "A new version is available" : notFound ? "Page not found" : "Something went wrong"}</h1>
        <p className="mt-2 text-slate-600">
          {staleBuild ? "Reload the page to get the latest version." : notFound ? "The link may be incorrect." : "Try reloading the page. If it keeps happening, the problem is on our side."}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            Reload
          </button>
          {!window.location.pathname.startsWith("/p/") && (
            <a href="/app" className="rounded-md px-4 py-2 text-sm font-medium text-brand ring-1 ring-slate-300 hover:bg-white">
              Go to proposals
            </a>
          )}
        </div>
      </div>
    </main>
  );
}

/** Shown while a lazy route's code loads. */
export function RouteLoading() {
  return <Preloader fullScreen />;
}
