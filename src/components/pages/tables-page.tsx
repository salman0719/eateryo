"use client";

import { RestaurantTables } from "@/components/tables/restaurant-tables";

export interface TablesPageProps {
  signedIn: boolean;
  sessionPending: boolean;
  /** The café the shell is acting in; the page follows it, never a second picker. */
  focusRestaurantId: string | null;
}

export function TablesPage({ signedIn, sessionPending, focusRestaurantId }: TablesPageProps) {
  return (
    <RestaurantTables
      signedIn={signedIn}
      sessionPending={sessionPending}
      focusRestaurantId={focusRestaurantId}
    />
  );
}
