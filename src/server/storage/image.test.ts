import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeLogo, sniffImageType } from "./image";

const enc = (s: string) => new TextEncoder().encode(s);

describe("sniffImageType", () => {
  it("accepts PNG, JPEG and WebP by magic bytes", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    const webp = new Uint8Array(12);
    webp.set(enc("RIFF"), 0);
    webp.set(enc("WEBP"), 8);
    expect(sniffImageType(webp)).toBe("webp");
  });

  it("rejects SVG, GIF, RIFF non-WebP, empty and short input", () => {
    expect(sniffImageType(enc("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(enc("<?xml version='1.0'?><svg/>"))).toBeNull();
    expect(sniffImageType(enc("GIF89a...."))).toBeNull();
    const wav = new Uint8Array(12);
    wav.set(enc("RIFF"), 0);
    wav.set(enc("WAVE"), 8);
    expect(sniffImageType(wav)).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("normalizeLogo", () => {
  it("re-encodes to a 256×256 WebP without metadata", async () => {
    const jpeg = await sharp({ create: { width: 300, height: 120, channels: 3, background: "#123456" } })
      .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
      .jpeg()
      .toBuffer();
    const out = await normalizeLogo(new Uint8Array(jpeg));
    const meta = await sharp(Buffer.from(out)).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 256, height: 256 });
    expect(meta.exif).toBeUndefined();
  });

  it("throws on undecodable data", async () => {
    await expect(normalizeLogo(new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2]))).rejects.toThrow();
  });
});
