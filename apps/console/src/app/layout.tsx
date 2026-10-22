import type { Metadata } from "next";
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
    title: { default: `${name} Operator Console`, template: `%s · ${name} Operator Console` },
    description: `SaaS operator console for ${name}`,
    icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
    // Never index the control plane.
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Script src="/env.js" strategy="beforeInteractive" />
        <Providers>{children}</Providers>
        {/* The console is permanently dark (see globals.css), so the toasts are too. */}
        <Toaster theme="dark" richColors position="top-right" />
      </body>
    </html>
  );
}
