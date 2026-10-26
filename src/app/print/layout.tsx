import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Print views: no app shell, white paper. */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-white text-[#0a0f1c] [color-scheme:light]">{children}</div>;
}
