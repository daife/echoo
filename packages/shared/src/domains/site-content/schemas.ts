import { z } from "zod";
import { SITE_ANNOUNCEMENT_MAX_LENGTH } from "./types.js";

export const updateSiteContentSchema = z.object({
  announcement: z.string().max(SITE_ANNOUNCEMENT_MAX_LENGTH),
});
