import path from "node:path";
import { env } from "../lib/env.js";
import { renderResumeDocument } from "../lib/document_rendering.js";

function resolveInputPath(inputArg?: string): string {
  if (inputArg) {
    return path.resolve(inputArg);
  }

  return path.resolve(env.JOB_AGENT_OUTPUT_DIR, "tailored-resume.md");
}

function resolveOutputBase(inputPath: string, outputArg?: string): string {
  if (outputArg) {
    const resolved = path.resolve(outputArg);
    const parsed = path.parse(resolved);
    if (parsed.ext.length > 0) {
      return path.join(parsed.dir, parsed.name);
    }
    return resolved;
  }

  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, parsed.name);
}

async function main() {
  const inputPath = resolveInputPath(process.argv[2]);
  const outputBase = resolveOutputBase(inputPath, process.argv[3]);
  const { htmlPath, pdfPath } = await renderResumeDocument(inputPath, outputBase);

  console.log(`Rendered HTML: ${htmlPath}`);
  console.log(`Rendered PDF:  ${pdfPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
