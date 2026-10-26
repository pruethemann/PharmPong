import "server-only";
import { cache } from "react";
import { readGameMode } from "./game-mode";

/** Active game mode for Server Components and layouts (request-cached). */
export const getActiveGameMode = cache(async () => (await readGameMode()).gameMode);
