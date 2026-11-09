"use client";

import { RestaurantSettings } from "@/components/settings/restaurant-settings";

export interface SettingsPageProps {
  signedIn: boolean;
  sessionPending: boolean;
  currentUserId: string | null;
  /** The café the shell is acting in; Settings follows it. */
  focusRestaurantId: string | null;
}

export function SettingsPage({
  signedIn,
  sessionPending,
  currentUserId,
  focusRestaurantId,
}: SettingsPageProps) {
  return (
    <RestaurantSettings
      signedIn={signedIn}
      sessionPending={sessionPending}
      currentUserId={currentUserId}
      focusRestaurantId={focusRestaurantId}
    />
  );
}
