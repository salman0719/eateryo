import Link from "next/link";

/**
 * Unknown `/r/<restaurant>` address. Like the menu not-found page, it says
 * plainly that nothing is served here without hinting at what exists.
 */
export default function RestaurantNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900">
        This restaurant link isn’t live
      </h1>
      <p className="text-sm leading-6 text-ink-600">
        The link may be mistyped, or the café hasn’t published a menu yet. Ask them for a fresh link
        or a QR code from one of their table cards.
      </p>
      <p className="mt-2 text-sm text-ink-500">
        <Link
          href="/"
          className="font-medium text-accent-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          Eateryo
        </Link>{" "}
        turns menu photos into editable, shareable menus.
      </p>
    </main>
  );
}
