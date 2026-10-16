import Link from "next/link";
import { NavLinks } from "./NavLinks";

export function AppBar() {
  return (
    <header className="ak-appbar nb-appbar">
      <Link href="/" className="nb-brand" aria-label="NoduleBridge, home">
        <span className="ak-appbar__logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/asklevia-logo-horizontal.svg" alt="Asklevia" height={28} />
        </span>
        <span className="nb-brand__divider" aria-hidden="true" />
        <span className="nb-brand__name">NoduleBridge</span>
      </Link>
      <NavLinks />
      <div className="ak-appbar__end">
        <span className="ak-badge ak-badge--outline">Hackathon prototype</span>
      </div>
    </header>
  );
}
