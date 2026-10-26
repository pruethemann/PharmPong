// QR codes for the tables: they only open the public table page (/elo/table/N). A QR code never
// grants anything: creating a match still needs a signed-in player and the other team's consent.
import "server-only";
import QRCode from "qrcode";
import { env } from "@/server/env";

export function eloTableUrl(tableNumber: number, base: string = env().APP_URL): string {
  return `${base.replace(/\/+$/, "")}/elo/table/${tableNumber}`;
}

/** Print-ready SVG (dark modules on white, quiet zone included). */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#0a0f1cff", light: "#ffffffff" },
  });
}
