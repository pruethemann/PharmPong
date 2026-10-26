import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EloMatchView } from "@/components/elo/match-view";
import { loadEloInitial } from "@/components/elo/load-elo";
import { DomainError } from "@/server/domain/errors";
import { getEloMatchDetail } from "@/server/services/elo-read";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function detailOrNull(id: string) {
  try {
    return await getEloMatchDetail(id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = await detailOrNull((await params).id);
  return { title: detail ? `Elo-Match an Tisch ${detail.tableNumber}` : "Match nicht gefunden" };
}

export default async function EloMatchPage({ params }: Props) {
  const detail = await detailOrNull((await params).id);
  if (!detail) notFound();
  // Live only for matches of the current Elo round; older rounds show the stored story.
  const elo = await loadEloInitial();
  const live =
    elo.mode !== "none" && elo.snapshot.session?.id === detail.sessionId
      ? { mode: elo.mode, snapshot: elo.snapshot }
      : null;
  return <EloMatchView detail={detail} live={live} />;
}
