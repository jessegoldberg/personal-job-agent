import path from "node:path";
import { writeText } from "../lib/fs.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { loadJobSource, parseJobSourceArgs } from "../lib/job_source.js";
import { assessJobFit } from "../lib/fit_assessment.js";

async function main() {
  const args = parseJobSourceArgs(process.argv);
  const defaultJobPath = path.join(env.JOB_AGENT_DATA_DIR, "jobs", "sample-job.md");
  const jobInput = {
    jobPath: args.jobPath ?? (!args.jobUrl ? defaultJobPath : undefined),
    jobUrl: args.jobUrl,
  };

  const [{ content: jobDescription, sourceLabel }] = await Promise.all([
    loadJobSource(jobInput),
  ]);

  const { fitReport, rawOutputText } = await assessJobFit(jobDescription, sourceLabel);

  const rawOutPath = path.join(env.JOB_AGENT_OUTPUT_DIR, "fit-report.raw.txt");
  const outPath = path.join(env.JOB_AGENT_OUTPUT_DIR, "fit-report.json");
  const serialized = JSON.stringify(fitReport, null, 2);

  await Promise.all([
    writeText(rawOutPath, rawOutputText),
    writeText(outPath, serialized),
  ]);

  logger.info({ outPath, rawOutPath, sourceLabel }, "Fit report written");
  console.log(serialized);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
