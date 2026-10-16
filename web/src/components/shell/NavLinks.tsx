"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Case" },
  { href: "/passport", label: "Passport" },
  { href: "/about", label: "About" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="ak-nav" aria-label="Main">
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="ak-nav__item"
          aria-current={pathname === href ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
