import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { auth } from "./api/auth/auth";
import { Providers } from "./providers";
import { LayoutShell } from "./components/nav/LayoutShell";
import { ServiceWorkerRegister } from "./components/notifications/ServiceWorkerRegister";
import { PreconnectLinks } from "./components/head/PreconnectLinks";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  title: "AI SDK RAG",
  description: "AI-powered RAG application",
  other: {
    'format-detection': 'telephone=no',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="en" suppressHydrationWarning data-theme="silk">
      <body className={`${mono.className} min-h-screen`} suppressHydrationWarning>
        <PreconnectLinks />
        <Providers session={session}>
          <div className="fixed inset-0 -z-10 bg-gradient-to-br from-base-200/80 via-base-100 to-base-200" />
          <ServiceWorkerRegister />
          <LayoutShell>
            {children}
          </LayoutShell>
        </Providers>
      </body>
    </html>
  );
}
