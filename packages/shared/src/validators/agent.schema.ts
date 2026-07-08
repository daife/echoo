import { z } from "zod";

const requiredText = (label: string) => z.string().trim().min(1, `${label} is required.`).max(2000);

export const createSliceAgentSchema = z.object({
  type: z.literal("slice"),
  name: requiredText("Agent name").max(80),
  persona: requiredText("Persona"),
  background: requiredText("Background"),
  personality: requiredText("Personality"),
  speechStyle: requiredText("Speech style"),
  openingLine: requiredText("Opening line")
});
