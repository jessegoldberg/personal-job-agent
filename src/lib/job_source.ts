import { readText } from "./fs.js";
import { withBrowser } from "./playwright.js";

export type JobSourceInput = {
  jobPath?: string;
  jobUrl?: string;
};

export type LoadedJobSource = {
  content: string;
  sourceLabel: string;
};

export function parseJobSourceArgs(argv: string[]): JobSourceInput {
  let jobPath: string | undefined;
  let jobUrl: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--url") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("Missing value for --url");
      }
      jobUrl = next;
      i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!jobPath) {
      jobPath = arg;
    }
  }

  return { jobPath, jobUrl };
}

export async function loadJobSource(input: JobSourceInput): Promise<LoadedJobSource> {
  if (input.jobUrl) {
    const content = await readJobFromUrl(input.jobUrl);
    return {
      content,
      sourceLabel: input.jobUrl,
    };
  }

  if (!input.jobPath) {
    throw new Error("Either a job file path or --url must be provided");
  }

  const content = await readText(input.jobPath);
  return {
    content,
    sourceLabel: input.jobPath,
  };
}

async function readJobFromUrl(url: string): Promise<string> {
  return withBrowser(async (page) => {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait for network to settle — increased timeout for JS-heavy SPA portals
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    // Extra settle time for portals like ADP that render content after network idle
    await page.waitForTimeout(3000);

    const content = await page.evaluate(() => {
      const selectorsToRemove = [
        "script",
        "style",
        "noscript",
        "svg",
        "iframe",
        "header",
        "footer",
        "nav",
        "[aria-hidden='true']",
      ];

      for (const selector of selectorsToRemove) {
        document.querySelectorAll(selector).forEach((node) => node.remove());
      }

      const title = document.title?.trim() ?? "";
      const metaDescription =
        document
          .querySelector("meta[name='description']")
          ?.getAttribute("content")
          ?.trim() ?? "";
      const bodyText = document.body?.innerText?.trim() ?? "";

      const cleanedBody = bodyText
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();

      return [title, metaDescription, cleanedBody].filter(Boolean).join("\n\n");
    });

    if (!content) {
      throw new Error(`Unable to extract job description text from URL: ${url}`);
    }

    // Warn if content is suspiciously short — likely a JS-rendered SPA that
    // didn't fully load. ADP Workforce Now and similar portals often require
    // additional wait time or interaction before job content is in the DOM.
    if (content.length < 300) {
      console.warn(
        `\nWARNING: Only ${content.length} characters scraped from ${url}\n` +
        `This page may require JavaScript rendering that Playwright did not wait for.\n` +
        `Try saving the job description to a local .md file and using:\n` +
        `  npm run fit -- data/jobs/your-job.md\n`
      );
    }

    return [`Source URL: ${url}`, "", content].join("\n");
  });
}