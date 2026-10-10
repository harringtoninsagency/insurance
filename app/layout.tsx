import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "./RegisterServiceWorker";

export const metadata: Metadata = {
  title: "FetchRival",
  description: "Internal FL homeowners listing-to-proposal engine",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#003049",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
