import type { ReactNode } from "react";
import "./globals.css";
export const metadata = { title: "AIA Acreditação", description: "Acreditação de pessoal externo" };
export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ locale?: string }> }) {
  const { locale } = await params;
  return <html lang={locale === "en" ? "en" : "pt-PT"}><body>{children}</body></html>;
}
