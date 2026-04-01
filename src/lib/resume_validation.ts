import path from "node:path";
import { z } from "zod";
import { readText } from "./fs.js";
import { complete } from "./model_client.js";
import { logger } from "./logger.js";

const validationSchema = z.object({
  approved: z.boolean(),
  summary: z.string(),
  truthfulnessIssues: z.array(z.string()),
  alignmentIssues: z.array(z.string()),
  formattingIssues: z.array(z.string()),
});

export type TailoredResumeValidation = z.infer<typeof validationSchema>;

type ValidateTailoredResumeInput = {
  jobDescription: string;
  baselineResume: string;
  masterResume: string;
  accomplishments: string;
  tailoredResume: string;
};

function tryParseValidation(text: string): TailoredResumeValidation | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  const candidates = [cleaned];
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      return validationSchema.parse(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  return null;
}

async function normalizeValidation(rawText: string): Promise<TailoredResumeValidation | null> {
  const systemPrompt = [
    "Convert the provided validation notes into strict JSON only.",
    "Do not add markdown, headings, explanations, or code fences.",
    "Return exactly one JSON object with these keys:",
    "{",
    '  "approved": boolean,',
    '  "summary": string,',
    '  "truthfulnessIssues": string[],',
    '  "alignmentIssues": string[],',
    '  "formattingIssues": string[]',
    "}",
    "Be conservative. If the notes are unclear, prefer approved=false.",
  ].join("\n");

  const normalizedText = await complete(
    "tailor",
    systemPrompt,
    `Validation notes to convert:\n\n${rawText}`
  );

  return tryParseValidation(normalizedText);
}

export async function validateTailoredResume(
  input: ValidateTailoredResumeInput
): Promise<TailoredResumeValidation> {
  const promptPath = path.join("src", "prompts", "validate-tailored-resume.txt");
  const systemPrompt = await readText(promptPath);

  const userContent = [
    "Baseline resume:",
    input.baselineResume,
    "",
    "Master resume:",
    input.masterResume,
    "",
    "Accomplishments:",
    input.accomplishments,
    "",
    "Job Description:",
    input.jobDescription,
    "",
    "Tailored Resume Draft:",
    input.tailoredResume,
  ].join("\n");

  const rawOutput = await complete("tailor", systemPrompt, userContent);
  const parsed = tryParseValidation(rawOutput);
  if (parsed) {
    return parsed;
  }

  logger.warn(
    { rawOutput: rawOutput.slice(0, 1000) },
    "Resume validation did not return valid JSON on first pass"
  );

  const normalized = await normalizeValidation(rawOutput);
  if (normalized) {
    return normalized;
  }

  logger.warn(
    { rawOutput: rawOutput.slice(0, 1000) },
    "Resume validation did not return valid JSON after normalization"
  );

  return {
    approved: false,
    summary: "Validation output could not be parsed reliably.",
    truthfulnessIssues: ["Validator output could not be parsed; manual review is required."],
    alignmentIssues: [],
    formattingIssues: [],
  };
}
