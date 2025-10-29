import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { auth } from "./api/auth/auth";
import { Nav } from "./components/auth/nav";
import { Providers } from "./providers";

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
            <input id="app-drawer" type="checkbox" className="drawer-toggle" />
            <div className="drawer-content">
              <Nav />
              <main className="container mx-auto p-4">
                {children}
              </main>
            </div>
            <div className="drawer-side">
              <label htmlFor="app-drawer" aria-label="close sidebar" className="drawer-overlay"></label>
              <aside className="w-80 min-h-full bg-base-200 text-base-content border-r">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <div>
                    <div className="text-sm text-base-content/70">Menu</div>
                    <div className="text-lg font-semibold">Navigation</div>
                  </div>
                  <label htmlFor="app-drawer" className="btn btn-ghost btn-square" aria-label="Close menu">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                  </label>
                </div>
                <ul className="menu p-4 gap-1">
                  <li>
                    <a href="/" className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0h6"/></svg>
                      Dashboard
                    </a>
                  </li>
                </ul>
              </aside>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
