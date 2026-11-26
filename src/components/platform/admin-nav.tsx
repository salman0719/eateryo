"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The admin section nav (B3) — the §4 left column as links. Overview,
 * accounts, cafés and the operator log; nothing here imports the café
 * shell, so no workspace state leaks into the panel.
 */

const SECTIONS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/accounts", label: "Accounts" },
  { href: "/admin/cafes", label: "Cafés" },
  { href: "/admin/activity", label: "Activity" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Platform admin sections">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {SECTIONS.map((section) => {
          const active = isActive(pathname, section.href);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "block rounded-lg bg-accent-100 px-3 py-2 text-sm font-semibold text-accent-800"
                    : "block rounded-lg px-3 py-2 text-sm text-ink-600 hover:bg-surface-100 hover:text-ink-900"
                }
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
