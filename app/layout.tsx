import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { auth } from "./api/auth/auth";
import { Nav } from "./components/auth/nav";
import { Providers } from "./providers";
import { Sidebar } from "./components/nav/Sidebar";
import { ServiceWorkerRegister } from "./components/notifications/ServiceWorkerRegister";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI SDK RAG",
  description: "AI-powered RAG application",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="en" suppressHydrationWarning data-theme="silk">
      <body className={`${inter.className} min-h-screen`} suppressHydrationWarning>
        <Providers session={session}>
          {/* Background */}
          <div className="fixed inset-0 -z-10 bg-gradient-to-br from-base-200/80 via-base-100 to-base-200" />
          <div id="app-drawer-wrapper" className="drawer">
            <ServiceWorkerRegister />
            <input id="app-drawer" type="checkbox" className="drawer-toggle" />
            <div className="drawer-content">
              <Nav />
              <main className="container mx-auto p-4">
                {children}
              </main>
            </div>
            <div className="drawer-side">
              <label htmlFor="app-drawer" aria-label="close sidebar" className="drawer-overlay"></label>
              <Sidebar />
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
