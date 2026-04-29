import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Claude Talk",
  description: "Voice-first interface for Claude Code sessions",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="darkTheme">
      <body>{children}</body>
    </html>
  );
}
