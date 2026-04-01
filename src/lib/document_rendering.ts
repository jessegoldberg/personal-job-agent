import path from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { readText, writeText } from "./fs.js";
import { markdownToHtml } from "./markdown.js";
import { buildResumeHtml } from "./resume_template.js";
import { buildCoverLetterHtml, parseResumeHeader } from "./cover_letter_template.js";
import { env } from "./env.js";

function stripExtension(value: string): string {
  const parsed = path.parse(value);
  return parsed.ext.length > 0 ? path.join(parsed.dir, parsed.name) : value;
}

async function renderPdfDocument(htmlDocument: string, pdfPath: string): Promise<void> {
  await mkdir(path.dirname(pdfPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlDocument, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: pdfPath,
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0in",
        right: "0in",
        bottom: "0in",
        left: "0in",
      },
    });
  } finally {
    await browser.close();
  }
}

export async function renderResumeDocument(inputPath: string, outputBasePath: string): Promise<{
  htmlPath: string;
  pdfPath: string;
}> {
  const normalizedInputPath = path.resolve(inputPath);
  const outputBase = stripExtension(path.resolve(outputBasePath));

  const [markdown, stylesheet] = await Promise.all([
    readText(normalizedInputPath),
    readText(path.resolve("src", "templates", "resume.css")),
  ]);

  const bodyHtml = await markdownToHtml(markdown);
  const title =
    markdown
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("# "))
      ?.replace(/^#\s+/, "")
      .trim() ?? path.parse(normalizedInputPath).name;

  const htmlDocument = buildResumeHtml({
    title,
    bodyHtml,
    stylesheet,
  });

  const htmlPath = `${outputBase}.html`;
  const pdfPath = `${outputBase}.pdf`;

  await writeText(htmlPath, htmlDocument);
  await renderPdfDocument(htmlDocument, pdfPath);

  return { htmlPath, pdfPath };
}

export async function renderCoverLetterDocument(
  inputPath: string,
  outputBasePath: string
): Promise<{
  htmlPath: string;
  pdfPath: string;
}> {
  const normalizedInputPath = path.resolve(inputPath);
  const outputBase = stripExtension(path.resolve(outputBasePath));
  const masterResumePath = path.join(env.JOB_AGENT_DATA_DIR, "resumes", "master_resume.md");

  const [coverMarkdown, masterResume, stylesheet] = await Promise.all([
    readText(normalizedInputPath),
    readText(masterResumePath),
    readText(path.resolve("src", "templates", "cover-letter.css")),
  ]);

  const { name, contactItems } = parseResumeHeader(masterResume);
  const bodyHtml = await markdownToHtml(coverMarkdown);

  const htmlDocument = buildCoverLetterHtml({
    name,
    contactItems,
    bodyHtml,
    stylesheet,
  });

  const htmlPath = `${outputBase}.html`;
  const pdfPath = `${outputBase}.pdf`;

  await writeText(htmlPath, htmlDocument);
  await renderPdfDocument(htmlDocument, pdfPath);

  return { htmlPath, pdfPath };
}
