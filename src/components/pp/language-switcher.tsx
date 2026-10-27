"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { setLocaleAction } from "@/server/actions/locale";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LanguageSwitcher({ current }: { current: Locale }) {
  const t = useTranslations("language");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={t("label")} disabled={pending} />}
      >
        <Languages />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) =>
            start(async () => {
              await setLocaleAction(String(value));
              router.refresh();
            })
          }
        >
          {locales.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale} className="min-h-11">
              {localeNames[locale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
