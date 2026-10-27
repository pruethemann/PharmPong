import { MOTTO_MAX, TEAM_NAME_MAX, TEAM_NAME_MIN } from "@/lib/validation/team";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/validation/auth";

/** Zod schemas emit `validation.<key>` as the issue message; it is translated at the edge. */
export const VALIDATION_PREFIX = "validation.";

/** ICU values for the `validation` namespace (limits come from the schema constants). */
export const validationParams = {
  passwordMin: PASSWORD_MIN,
  passwordMax: PASSWORD_MAX,
  nameMin: 2,
  nameMax: 40,
  teamNameMin: TEAM_NAME_MIN,
  teamNameMax: TEAM_NAME_MAX,
  mottoMax: MOTTO_MAX,
};
