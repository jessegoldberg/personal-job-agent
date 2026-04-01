import path from "node:path";
import { env } from "../lib/env.js";
import { readText } from "../lib/fs.js";
import { tailorResumeForJob } from "../lib/tailor_resume_workflow.js";

async function main() {
  const jobPath = process.argv[2] || path.join(env.JOB_AGENT_DATA_DIR, "jobs", "sample-job.md");
  const jobDescription = await readText(jobPath);
  const result = await tailorResumeForJob({
    jobDescription,
    baselineResumePath: process.argv[3],
  });
  const outputText = await readText(result.outPath);
  console.log(outputText);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
