import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { auth } from "./api/auth/auth";
import { Providers } from "./providers";
import { LayoutShell } from "./components/nav/LayoutShell";
import { PreconnectLinks } from "./components/head/PreconnectLinks";
import { THEME_INIT_SCRIPT } from "./components/theme/theme";

const sans = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: 'swap',
  preload: true,
});

const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: 'swap',
  preload: false,
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
      <head>
        {/* Applies the stored theme before first paint. Without this the
            server-rendered `silk` flashes for anyone whose choice is `dark`. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${sans.variable} ${mono.variable} font-sans min-h-screen`}
        suppressHydrationWarning
      >
        <PreconnectLinks />
        <Providers session={session}>
          <LayoutShell>
            {children}
          </LayoutShell>
        </Providers>
      </body>
    </html>
  );
}
