import path from "node:path";
import { env } from "../lib/env.js";
import { readText } from "../lib/fs.js";
import { draftCoverLetterForJob } from "../lib/cover_letter_workflow.js";

async function main() {
  const jobPath = process.argv[2] || path.join(env.JOB_AGENT_DATA_DIR, "jobs", "sample-job.md");
  const outputText = await readText(
    (
      await draftCoverLetterForJob({
        jobDescription: await readText(jobPath),
        baselineResumePath: process.argv[3],
      })
    ).outPath
  );
  console.log(outputText);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
