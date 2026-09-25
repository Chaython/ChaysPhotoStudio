import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { AppBridges } from "./native-bridges";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const basePath = process.env.NEXT_BASE_PATH || "";
const asset = (path: string) => `${basePath}${path}`;

export const metadata: Metadata = {
  title: "Chay's Photo Studio — Web Image Editor",
  description: "A Photoshop-class raster image editor that runs entirely in your browser: layers, masks, smart objects, content-aware fill, actions and scripting.",
  keywords: ["image editor", "photo editor", "layers", "masks", "content-aware fill", "web photoshop"],
  authors: [{ name: "Chaython Meredith" }],
  applicationName: "Chay's Photo Studio",
  manifest: asset("/manifest.webmanifest"),
  icons: {
    icon: [
      { url: asset("/icon.svg"), type: "image/svg+xml" },
      { url: asset("/icons/icon-192.png"), sizes: "192x192", type: "image/png" },
      { url: asset("/icons/icon-512.png"), sizes: "512x512", type: "image/png" },
      { url: asset("/favicon.ico"), sizes: "16x16 32x32 48x48" },
    ],
    apple: [{ url: asset("/icons/apple-touch-icon.png"), sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Chay's Photo Studio",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <AppBridges />
      </body>
    </html>
  );
}
