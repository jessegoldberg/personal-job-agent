/**
 * model_client.ts
 *
 * Unified interface for OpenAI (cloud) and Ollama (local) model calls.
 *
 * Key differences handled here:
 *   - OpenAI uses client.responses.create() with { input: [...] }
 *   - Ollama uses client.chat.completions.create() with { messages: [...] }
 *   - deepseek-r1 wraps output in <think>...</think> before the real answer
 *
 * Usage:
 *   const result = await complete("fit", systemPrompt, userContent);
 *
 * Agent names: "fit" | "tailor" | "cover" | "answers"
 */

import OpenAI from "openai";
import { env } from "./env.js";
import { logger } from "./logger.js";

export type AgentName = "fit" | "tailor" | "cover" | "answers";

function shouldUseLocal(agent: AgentName): boolean {
  if (!env.JOB_AGENT_LOCAL_MODEL) return false;

  const useLocal = env.JOB_AGENT_USE_LOCAL.toLowerCase().trim();

  if (useLocal === "all") return true;

  const agents = useLocal.split(",").map((s) => s.trim());
  return agents.includes(agent);
}

/**
 * Strip <think>...</think> blocks emitted by deepseek-r1 and similar
 * reasoning models before parsing the actual output.
 */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function previewText(value: string, maxLength = 220): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${env.JOB_AGENT_MODEL_TIMEOUT_MS}ms`));
    }, env.JOB_AGENT_MODEL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Call the model for the given agent and return the text output.
 * Automatically routes to OpenAI or Ollama based on env config.
 */
export async function complete(
  agent: AgentName,
  systemPrompt: string,
  userContent: string
): Promise<string> {
  const startedAt = Date.now();

  logger.info(
    {
      agent,
      usesLocal: shouldUseLocal(agent),
      systemPromptPreview: previewText(systemPrompt, 140),
      userContentPreview: previewText(userContent, 220),
      userContentLength: userContent.length,
    },
    "Starting model completion"
  );

  try {
    const output = shouldUseLocal(agent)
      ? await completeLocal(agent, systemPrompt, userContent)
      : await completeOpenAI(agent, systemPrompt, userContent);

    logger.info(
      {
        agent,
        durationMs: Date.now() - startedAt,
        outputLength: output.length,
        outputPreview: previewText(output, 220),
      },
      "Completed model completion"
    );

    return output;
  } catch (error) {
    logger.error(
      {
        agent,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
      "Model completion failed"
    );
    throw error;
  }
}

async function completeOpenAI(
  agent: AgentName,
  systemPrompt: string,
  userContent: string
): Promise<string> {
  const model = env.JOB_AGENT_MODEL;
  logger.info({ agent, model, source: "openai" }, "Using OpenAI model");

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const response = await withTimeout(
    client.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
    `OpenAI request for agent ${agent}`
  );

  return response.output_text;
}

async function completeLocal(
  agent: AgentName,
  systemPrompt: string,
  userContent: string
): Promise<string> {
  const model = env.JOB_AGENT_LOCAL_MODEL!;
  logger.info({ agent, model, source: "local" }, "Using local Ollama model");

  const client = new OpenAI({
    apiKey: "ollama",
    baseURL: env.JOB_AGENT_OLLAMA_BASE_URL,
  });

  const response = await withTimeout(
    client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
    `Ollama request for agent ${agent}`
  );

  const raw = response.choices[0]?.message?.content ?? "";
  return stripThinkTags(raw);
}