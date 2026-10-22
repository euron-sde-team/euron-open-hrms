import type { Metadata, Viewport } from "next";
import Script from "next/script";
// Self-hosted fonts: no request to a font CDN at build time or at runtime.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { serverEnv } from "@/lib/runtime-env";
import { Toaster } from "@open-hrms/ui/sonner";

// Rendered per request so the product name (and /env.js) come from the
// container's environment, not from whatever was set when the image was built.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const name = serverEnv().PRODUCT_NAME;
  return {
    title: { default: name, template: `%s · ${name}` },
    description: `${name}: people, payroll, leave and more`,
    // Installable + a home-screen icon, which is also what makes web push
    // possible on iOS: Safari only delivers to a home-screen app.
    manifest: "/manifest.json",
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: "/apple-touch-icon.png",
    },
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: "#0f6e5e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {/* Runtime config (API URL, product name) before any client code reads it. */}
        <Script src="/env.js" strategy="beforeInteractive" />
        <Providers>{children}</Providers>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
