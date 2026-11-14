import { AppShell } from "@/components/layout/app-shell";

/**
 * The publish wizard. This is also the URL a magic link returns to, so it
 * keeps working for a visitor who is not signed in yet — the shell gates it
 * itself rather than the route refusing.
 */
export default function MenuPublishPage() {
  return <AppShell />;
}
