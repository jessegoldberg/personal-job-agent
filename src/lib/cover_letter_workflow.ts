import path from "node:path";
import { readText, writeText } from "./fs.js";
import { complete } from "./model_client.js";
import { env } from "./env.js";

export async function draftCoverLetterForJob(options: {
  jobDescription: string;
  baselineResumePath?: string;
  outputDir?: string;
}): Promise<{ outPath: string }> {
  const baselineResumePath =
    options.baselineResumePath || path.join(env.JOB_AGENT_DATA_DIR, "resumes", "master_resume.md");
  const masterResumePath = path.join(env.JOB_AGENT_DATA_DIR, "resumes", "master_resume.md");
  const voicePath = path.join(env.JOB_AGENT_DATA_DIR, "profiles", "voice_profile.md");
  const promptPath = path.join("src", "prompts", "draft-cover-letter.txt");
  const outputDir = options.outputDir ?? env.JOB_AGENT_OUTPUT_DIR;

  const [baselineResume, masterResume, voice, systemPrompt] = await Promise.all([
    readText(baselineResumePath),
    readText(masterResumePath),
    readText(voicePath),
    readText(promptPath),
  ]);

  const userContent = [
    "Voice profile:",
    voice,
    "",
    "Baseline resume:",
    baselineResume,
    "",
    "Master resume:",
    masterResume,
    "",
    "Job Description:",
    options.jobDescription,
  ].join("\n");

  const outputText = await complete("cover", systemPrompt, userContent);
  const outPath = path.join(outputDir, "cover-letter.md");
  await writeText(outPath, outputText);
  return { outPath };
}
