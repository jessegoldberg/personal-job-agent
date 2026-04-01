import path from "node:path";
import { readText, writeText } from "../lib/fs.js";
import { complete } from "../lib/model_client.js";
import { env } from "../lib/env.js";

async function main() {
  const jobPath = process.argv[2] || path.join(env.JOB_AGENT_DATA_DIR, "jobs", "sample-job.md");
  const baselineResumePath =
    process.argv[3] || path.join(env.JOB_AGENT_DATA_DIR, "resumes", "master_resume.md");
  const masterResumePath = path.join(env.JOB_AGENT_DATA_DIR, "resumes", "master_resume.md");
  const preferencesPath = path.join(env.JOB_AGENT_DATA_DIR, "profiles", "preferences.json");
  const promptPath = path.join("src", "prompts", "prepare-application.txt");

  const [jobDescription, baselineResume, masterResume, preferences, systemPrompt] =
    await Promise.all([
      readText(jobPath),
      readText(baselineResumePath),
      readText(masterResumePath),
      readText(preferencesPath),
      readText(promptPath),
    ]);

  const userContent = [
    "Baseline resume:",
    baselineResume,
    "",
    "Master resume:",
    masterResume,
    "",
    "Preferences:",
    preferences,
    "",
    "Job Description:",
    jobDescription,
  ].join("\n");

  const outputText = await complete("answers", systemPrompt, userContent);

  const outPath = path.join(env.JOB_AGENT_OUTPUT_DIR, "application-answers.md");
  await writeText(outPath, outputText);
  console.log(outputText);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
