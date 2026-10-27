"use client";

import { useTranslations } from "next-intl";
import { VALIDATION_PREFIX, validationParams } from "./validation";

/** Translate a schema issue message (`validation.<key>`); other text passes through unchanged. */
export function useValidationText(): (message?: string) => string | undefined {
  const t = useTranslations("validation");
  return (message) =>
    message?.startsWith(VALIDATION_PREFIX)
      ? t(message.slice(VALIDATION_PREFIX.length), validationParams)
      : message;
}
