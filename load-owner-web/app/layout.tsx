import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider, LanguageSelect } from "../i18n/LocaleProvider";
import { AuthProvider } from "@/lib/AuthProvider";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "Dray — Ship a Load",
  description: "Post shipments and track drivers in real time on Dray",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LocaleProvider>
          <AuthProvider>
            <div className="flex justify-end border-b border-slate-200 bg-white px-6 py-3">
              <LanguageSelect />
            </div>
            <AuthGate>{children}</AuthGate>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
