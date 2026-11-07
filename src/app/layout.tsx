import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SIDEBAR_BOOT_SCRIPT } from "@/components/layout/sidebar-preference";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eateryo",
  description:
    "Turn a menu photo into structured, editable menu data, preview the diner's order page, and take table orders.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* Before the shell paints: a saved sidebar choice must not flash the
            other width. Inline on purpose — an effect runs after first paint. */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
