import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Claude Talk",
  description: "Voice-first interface for Claude Code sessions",
  manifest: "/manifest.webmanifest",
  applicationName: "Claude Talk",
  appleWebApp: {
    capable: true,
    title: "Claude Talk",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#191814",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="darkTheme" suppressHydrationWarning>
      <head>
        {/* Belt-and-suspenders for older iOS Safari that doesn't fully honor
            metadata.appleWebApp from the App Router yet. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Claude Talk" />
      </head>
      <body>{children}</body>
    </html>
  );
}
