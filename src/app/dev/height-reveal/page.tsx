import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { HeightRevealDemo } from "./demo";

export const metadata: Metadata = {
  title: "Height reveal — dev",
  robots: { index: false, follow: false },
};

/** Dev-only showcase so the animation can be judged in a real browser. */
export default function HeightRevealDevPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <>
      <SiteHeader />
      <main className="w-full flex-1">
        <HeightRevealDemo />
      </main>
      <SiteFooter />
    </>
  );
}
