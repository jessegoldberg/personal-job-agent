import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  JOB_AGENT_MODEL: z.string().default("gpt-5"),
  JOB_AGENT_OUTPUT_DIR: z.string().default("./output"),
  JOB_AGENT_DATA_DIR: z.string().default("./data"),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  JOB_AGENT_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  PLAYWRIGHT_STORAGE_STATE_PATH: z.string().default("./data/generated/playwright-state.json"),

  // Local Ollama config
  JOB_AGENT_LOCAL_MODEL: z.string().optional(),
  JOB_AGENT_USE_LOCAL: z.string().default("fit,answers"),
  JOB_AGENT_OLLAMA_BASE_URL: z.string().default("http://localhost:11434/v1"),

  // LinkedIn scout
  LINKEDIN_EMAIL: z.string().default(""),
  LINKEDIN_PASSWORD: z.string().default(""),
});

export const env = envSchema.parse(process.env);
