import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Anzeige",
  robots: { index: false, follow: false },
};

/** Projector view: no app shell, no navigation, full viewport. */
export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh w-full overflow-hidden">{children}</div>;
}
