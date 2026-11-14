import { HomeScreen } from "@/components/home-screen";

/**
 * A menu URL the app no longer mints — the in-editor Table QR links from before
 * QR cards moved to Tables, and any other stale sub-path. The route is read
 * from the URL like every other screen, and `parseAppRoute` lands an
 * unrecognised shape in the library with a message rather than a blank page or
 * a 404, which is the promise old bookmarks were given.
 */
export default function StaleMenuPathPage() {
  return <HomeScreen />;
}
