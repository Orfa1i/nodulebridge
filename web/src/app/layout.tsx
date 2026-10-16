import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import type { ReactNode } from "react";
import { AppBar } from "@/components/shell/AppBar";
import { SafetyBanner } from "@/components/shell/SafetyBanner";
import { LocaleProvider } from "@/lib/locale";
import "@/styles/tokens.css";
import "@/styles/bundle.css";
import "@/styles/nodulebridge-extensions.css";
import "./shell.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NoduleBridge · Asklevia",
  description:
    "Follow-up support for incidental lung nodules. Decision and adherence support only, not a diagnosis.",
  icons: { icon: "/brand/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={plexArabic.variable}>
      <body className="ak-app">
        <LocaleProvider>
          <a className="nb-skip" href="#main">
            Skip to content
          </a>
          <AppBar />
          <SafetyBanner />
          <main id="main" className="nb-page">
            {children}
          </main>
        </LocaleProvider>
      </body>
    </html>
  );
}
