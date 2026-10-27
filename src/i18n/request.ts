import { getRequestConfig } from "next-intl/server";
import { getAppLocale } from "./server";
import { localeTags } from "./config";

export default getRequestConfig(async () => {
  const appLocale = await getAppLocale();
  return {
    // next-intl needs a valid BCP 47 tag; "en-x-pirate" formats like English.
    locale: localeTags[appLocale].lang,
    timeZone: "Europe/Zurich",
    messages: (await import(`../../messages/${appLocale}.json`)).default,
  };
});
