import { getTeamLogo } from "@/server/services/team-logo";

// Team logos are public (shown on the display and bracket). The bucket stays
// private; this route proxies reads. A URL carrying the current ?v= is immutable.
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(teamId)) return new Response("Not found", { status: 404 });
  const logo = await getTeamLogo(teamId);
  if (!logo) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  }
  const v = new URL(request.url).searchParams.get("v");
  const current = v !== null && v === String(logo.logoVersion);
  return new Response(Buffer.from(logo.bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(logo.bytes.byteLength),
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
