import path from "node:path";
import { env } from "../lib/env.js";
import { readText } from "../lib/fs.js";
import { loadJobSource, parseJobSourceArgs } from "../lib/job_source.js";
import { runJobPipeline } from "../lib/job_pipeline.js";

function extractField(jobMarkdown: string, label: string): string {
  const match = jobMarkdown.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"));
  return match?.[1]?.trim() ?? "";
}

function extractTitle(jobMarkdown: string): string {
  const match = jobMarkdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "Unknown Role";
}

async function main() {
  const args = parseJobSourceArgs(process.argv);
  const defaultJobPath = path.join(env.JOB_AGENT_DATA_DIR, "jobs", "sample-job.md");
  const loaded = await loadJobSource({
    jobPath: args.jobPath ?? (!args.jobUrl ? defaultJobPath : undefined),
    jobUrl: args.jobUrl,
  });

  const jobMarkdown = loaded.content;
  const title = extractTitle(jobMarkdown);
  const company = extractField(jobMarkdown, "Company") || "Unknown Company";
  const location = extractField(jobMarkdown, "Location") || undefined;
  const applyUrl = extractField(jobMarkdown, "Apply URL") || undefined;
  const postedText = extractField(jobMarkdown, "Posted") || undefined;
  const description = /## Description\s+([\s\S]*)$/m.exec(jobMarkdown)?.[1]?.trim() ?? jobMarkdown;

  const result = await runJobPipeline({
    jobDescription: description,
    sourceLabel: loaded.sourceLabel,
    company,
    title,
    location,
    applyUrl,
    postedText,
    easyApply: /^yes$/i.test(extractField(jobMarkdown, "Easy Apply")),
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
