"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { removeTeamLogoAction, uploadTeamLogoAction } from "@/server/actions/teams";

const MAX_BYTES = 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp";

export function LogoUploader({
  teamId,
  teamName,
  logoUrl,
}: {
  teamId: string;
  teamName: string;
  logoUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  function choose(f: File | undefined) {
    setError(undefined);
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      setError("Nur PNG, JPEG oder WebP.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("Das Bild ist grösser als 1 MB.");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function reset() {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function upload() {
    if (!file) return;
    start(async () => {
      const fd = new FormData();
      fd.set("teamId", teamId);
      fd.set("file", file);
      const res = await uploadTeamLogoAction(fd);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      reset();
      toast.success("Logo gespeichert");
      router.refresh();
    });
  }

  function remove() {
    start(async () => {
      const res = await removeTeamLogoAction({ teamId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Logo entfernt");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
          <img
            src={preview}
            alt="Vorschau des neuen Logos"
            className="ring-primary size-28 rounded-2xl object-cover ring-2"
          />
        ) : (
          <TeamAvatar name={teamName} logoUrl={logoUrl} size="xl" />
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="logo-file" className="text-base">
            Teamlogo
          </Label>
          <p id="logo-hint" className="text-muted-foreground text-sm">
            PNG, JPEG oder WebP, max. 1 MB. Wird quadratisch zugeschnitten.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        id="logo-file"
        type="file"
        accept={ACCEPT}
        className="file:bg-muted file:text-foreground text-muted-foreground touch-target file:touch-target w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:px-4 file:font-semibold"
        aria-describedby={error ? "logo-error" : "logo-hint"}
        aria-invalid={!!error}
        onChange={(e) => choose(e.target.files?.[0])}
      />
      {error && (
        <p id="logo-error" role="alert" className="text-destructive text-sm font-medium">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {file && (
          <>
            <Button type="button" onClick={upload} disabled={pending}>
              <ImagePlus aria-hidden="true" />
              {pending ? "Wird hochgeladen …" : "Logo hochladen"}
            </Button>
            <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
              Abbrechen
            </Button>
          </>
        )}
        {!file && logoUrl && (
          <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
            <Trash2 aria-hidden="true" />
            Logo entfernen
          </Button>
        )}
      </div>
    </div>
  );
}
