import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PaymentsDevDemo } from "./demo";

export const metadata: Metadata = {
  title: "Payments — dev",
  robots: { index: false, follow: false },
};

/** Dev-only forced-state harness: `/dev/payments?state=pending`. */
export default async function PaymentsDevPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { state } = await searchParams;

  return (
    <>
      <SiteHeader />
      <main className="w-full flex-1">
        <PaymentsDevDemo forcedState={state} />
      </main>
      <SiteFooter />
    </>
  );
}
