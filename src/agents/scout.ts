import path from "node:path";
import type { Page } from "playwright";
import { readText, writeText } from "../lib/fs.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { withBrowser } from "../lib/playwright.js";
import { runJobPipeline } from "../lib/job_pipeline.js";
import type { FitAssessment } from "../types/fit.js";

type Preferences = {
  targetTitles?: string[];
  fitThresholds?: {
    apply_now?: number;
    apply_with_caution?: number;
  };
};

type ScoutArgs = {
  limitPerTitle: number;
};

type LinkedInJobCard = {
  jobId: string;
  jobUrl: string;
};

type LinkedInJobDetail = {
  jobId: string;
  title: string;
  company: string;
  location: string;
  postedText: string;
  jobUrl: string;
  applyUrl?: string;
  easyApply: boolean;
  description: string;
};

type ScannedJobRecord = {
  jobId: string;
  jobUrl: string;
  title: string;
  company: string;
  searchTitle: string;
  scannedAt: string;
  score?: number;
  recommendation: FitAssessment["recommendation"] | "error";
  saved: boolean;
  applyUrl?: string;
  outputDir?: string;
  error?: string;
};

type ScoutTracker = {
  scannedJobs: Record<string, ScannedJobRecord>;
};

type SavedMatchSummary = {
  company: string;
  title: string;
  score: number;
  recommendation: FitAssessment["recommendation"];
  outputDir: string;
};

type ScoutSummary = {
  searchedTitles: string[];
  scannedCount: number;
  skippedPreviouslyScannedCount: number;
  savedCount: number;
  savedMatches: SavedMatchSummary[];
};

const LINKEDIN_BASE_URL = "https://www.linkedin.com";
const TRACKER_PATH = path.join(env.JOB_AGENT_DATA_DIR, "generated", "linkedin-scanned-jobs.json");
const JOB_PROCESS_TIMEOUT_MS = 90000;
const LINKEDIN_NAV_TIMEOUT_MS = 15000;
const LINKEDIN_SETTLE_MS = 1200;
const LOCATOR_TIMEOUT_MS = 1200;

type LinkedInPageDiagnostics = {
  finalUrl: string;
  titleText: string;
  companyText: string;
  descriptionLength: number;
  pageTitle: string;
  bodyPreview: string;
};

async function main() {
  const args = parseScoutArgs(process.argv);
  const preferences = await loadPreferences();
  const targetTitles = normalizeTargetTitles(preferences);

  if (targetTitles.length === 0) {
    throw new Error("No targetTitles found in data/profiles/preferences.json");
  }

  if (!env.LINKEDIN_EMAIL || !env.LINKEDIN_PASSWORD) {
    throw new Error("LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in the environment");
  }

  const tracker = await loadTracker();

  const summary = await withBrowser(
    async (page) => {
      await loginToLinkedIn(page);
      await openLinkedInJobs(page);

    const savedMatches: SavedMatchSummary[] = [];
    let scannedCount = 0;
    let skippedPreviouslyScannedCount = 0;

    for (const searchTitle of targetTitles) {
      logger.info({ searchTitle }, "Searching LinkedIn jobs");
      const cards = await collectJobCardsForTitle(page, searchTitle, args.limitPerTitle);

      logger.info(
        { searchTitle, discoveredCards: cards.length, limitPerTitle: args.limitPerTitle },
        "Collected LinkedIn job cards"
      );

      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];

        if (tracker.scannedJobs[card.jobUrl]) {
          skippedPreviouslyScannedCount += 1;
          logger.info(
            {
              searchTitle,
              index: index + 1,
              total: cards.length,
              jobUrl: card.jobUrl,
            },
            "Skipping previously scanned job"
          );
          continue;
        }

        logger.info(
          {
            searchTitle,
            index: index + 1,
            total: cards.length,
            jobUrl: card.jobUrl,
            jobId: card.jobId,
          },
          "Processing LinkedIn job"
        );

        try {
          const result = await withTimeout(
            processJobCard(page, card, searchTitle, preferences),
            `Scout processing for ${card.jobUrl}`
          );

          tracker.scannedJobs[result.detail.jobUrl] = {
            jobId: result.detail.jobId,
            jobUrl: result.detail.jobUrl,
            title: result.detail.title,
            company: result.detail.company,
            searchTitle,
            scannedAt: new Date().toISOString(),
            score: result.fitReport.score,
            recommendation: result.fitReport.recommendation,
            saved: result.shouldSave,
            applyUrl: result.detail.applyUrl,
            outputDir: result.outputDir,
          };

          if (result.shouldSave && result.outputDir) {
            savedMatches.push({
              company: result.detail.company,
              title: result.detail.title,
              score: result.fitReport.score,
              recommendation: result.fitReport.recommendation,
              outputDir: result.outputDir,
            });
          }

          scannedCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const diagnostics = await collectLinkedInPageDiagnostics(page).catch(() => undefined);

          logger.warn(
            { searchTitle, jobUrl: card.jobUrl, error: message, diagnostics },
            "Failed to process LinkedIn job"
          );

          tracker.scannedJobs[card.jobUrl] = {
            jobId: card.jobId,
            jobUrl: card.jobUrl,
            title: "",
            company: "",
            searchTitle,
            scannedAt: new Date().toISOString(),
            recommendation: "error",
            saved: false,
            error: message,
          };

          scannedCount += 1;
        }

        await saveTracker(tracker);
      }
    }

    return {
        searchedTitles: targetTitles,
        scannedCount,
        skippedPreviouslyScannedCount,
        savedCount: savedMatches.length,
        savedMatches,
      } satisfies ScoutSummary;
    },
    { storageStatePath: env.PLAYWRIGHT_STORAGE_STATE_PATH }
  );

  await saveTracker(tracker);
  console.log(JSON.stringify(summary, null, 2));
}

function parseScoutArgs(argv: string[]): ScoutArgs {
  let limitPerTitle = 20;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--limit") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("Missing value for --limit");
      }

      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${next}`);
      }

      limitPerTitle = parsed;
      i += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { limitPerTitle };
}

async function loadPreferences(): Promise<Preferences> {
  const preferencesPath = path.join(env.JOB_AGENT_DATA_DIR, "profiles", "preferences.json");
  const raw = await readText(preferencesPath);
  return JSON.parse(raw) as Preferences;
}

function normalizeTargetTitles(preferences: Preferences): string[] {
  const titles = preferences.targetTitles ?? [];
  const deduped = new Set<string>();

  for (const title of titles) {
    const normalized = title.trim();
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return [...deduped];
}

async function loadTracker(): Promise<ScoutTracker> {
  try {
    const raw = await readText(TRACKER_PATH);
    const parsed = JSON.parse(raw) as Partial<ScoutTracker>;

    return {
      scannedJobs: parsed.scannedJobs ?? {},
    };
  } catch {
    return {
      scannedJobs: {},
    };
  }
}

async function saveTracker(tracker: ScoutTracker): Promise<void> {
  await writeText(TRACKER_PATH, JSON.stringify(tracker, null, 2));
}

async function loginToLinkedIn(page: Page): Promise<void> {
  await page.goto(`${LINKEDIN_BASE_URL}/jobs/`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(1500);

  if (!(await isLinkedInLoginPage(page))) {
    logger.info("LinkedIn session already active from saved browser state");
    return;
  }

  logger.info("Saved LinkedIn session not valid, logging in again");
  await page.goto(`${LINKEDIN_BASE_URL}/login`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  if (!(await isLinkedInLoginPage(page))) {
    logger.info("LinkedIn redirected away from login, session is already active");
    return;
  }

  await page.locator("input[name='session_key']").fill(env.LINKEDIN_EMAIL);
  await page.locator("input[name='session_password']").fill(env.LINKEDIN_PASSWORD);
  await page.locator("button[type='submit']").click();

  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);

  const challengeDetected = await page
    .locator("input[name='pin'], input#input__email_verification_pin, form[action*='checkpoint']")
    .first()
    .isVisible()
    .catch(() => false);

  if (challengeDetected) {
    throw new Error(
      "LinkedIn login requires verification or checkpoint approval. Complete it in the browser session and re-run scout."
    );
  }

  await page.goto(`${LINKEDIN_BASE_URL}/jobs/`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1500);

  if (await isLinkedInLoginPage(page)) {
    throw new Error("LinkedIn login did not persist. Check credentials or complete any required verification.");
  }
}

async function isLinkedInLoginPage(page: Page): Promise<boolean> {
  const hasLoginField = await page
    .locator("input[name='session_key'], input[name='session_password']")
    .first()
    .isVisible()
    .catch(() => false);

  if (hasLoginField) {
    return true;
  }

  const currentUrl = page.url().toLowerCase();
  return currentUrl.includes("/login") || currentUrl.includes("/checkpoint");
}

async function openLinkedInJobs(page: Page): Promise<void> {
  const jobsLink = page.locator("a[href*='/jobs/']").first();

  if (await jobsLink.isVisible().catch(() => false)) {
    await jobsLink.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    return;
  }

  await page.goto(`${LINKEDIN_BASE_URL}/jobs/`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
}

function buildLinkedInSearchUrl(searchTitle: string): string {
  const url = new URL(`${LINKEDIN_BASE_URL}/jobs/search/`);
  url.searchParams.set("keywords", searchTitle);
  url.searchParams.set("location", "United States");
  url.searchParams.set("f_TPR", "r86400");
  url.searchParams.set("f_WT", "2");
  url.searchParams.set("position", "1");
  url.searchParams.set("pageNum", "0");
  return url.toString();
}

async function collectJobCardsForTitle(
  page: Page,
  searchTitle: string,
  limitPerTitle: number
): Promise<LinkedInJobCard[]> {
  await page.goto(buildLinkedInSearchUrl(searchTitle), {
    waitUntil: "domcontentloaded",
    timeout: LINKEDIN_NAV_TIMEOUT_MS,
  });

  await page.waitForTimeout(LINKEDIN_SETTLE_MS);

  return page.evaluate((limit) => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        "a.job-card-container__link, a.job-card-list__title, a[data-control-name='job_card_click'], a[href*='/jobs/view/']"
      )
    );

    const results: Array<{ jobId: string; jobUrl: string }> = [];
    const seen = new Set<string>();

    for (const anchor of anchors) {
      const href = anchor.href?.trim();
      if (!href || !href.includes("/jobs/view/")) {
        continue;
      }

      const url = new URL(href, window.location.origin);
      url.hash = "";
      url.search = "";

      const jobUrl = url.toString();
      const match = jobUrl.match(/\/jobs\/view\/(\d+)/);
      const jobId = match?.[1] ?? jobUrl;

      if (seen.has(jobUrl)) {
        continue;
      }

      seen.add(jobUrl);
      results.push({ jobId, jobUrl });

      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }, limitPerTitle);
}

async function processJobCard(
  page: Page,
  card: LinkedInJobCard,
  searchTitle: string,
  preferences: Preferences
): Promise<{
  detail: LinkedInJobDetail;
  fitReport: FitAssessment;
  shouldSave: boolean;
  outputDir?: string;
}> {
  const detail = await scrapeJobDetail(page, card.jobUrl, card.jobId);

  logger.info(
    {
      searchTitle,
      title: detail.title,
      company: detail.company,
      jobUrl: detail.jobUrl,
      descriptionLength: detail.description.length,
    },
    "Extracted LinkedIn job detail"
  );

  logger.info(
    {
      searchTitle,
      title: detail.title,
      company: detail.company,
      jobUrl: detail.jobUrl,
    },
    "Starting job pipeline"
  );

  const pipelineResult = await runJobPipeline({
    jobDescription: detail.description,
    sourceLabel: detail.jobUrl,
    company: detail.company,
    title: detail.title,
    location: detail.location,
    applyUrl: detail.applyUrl,
    easyApply: detail.easyApply,
    postedText: detail.postedText,
  });
  const fitReport = pipelineResult.fitReport;

  logger.info(
    {
      searchTitle,
      title: detail.title,
      company: detail.company,
      jobUrl: detail.jobUrl,
      score: fitReport.score,
      recommendation: fitReport.recommendation,
      action: pipelineResult.action,
    },
    "Completed job pipeline"
  );

  const shouldSave = pipelineResult.action !== "skip";
  const outputDir = pipelineResult.outputDir;

  return {
    detail,
    fitReport,
    shouldSave,
    outputDir,
  };
}

async function scrapeJobDetail(
  page: Page,
  jobUrl: string,
  fallbackJobId: string
): Promise<LinkedInJobDetail> {
  await page.goto(jobUrl, {
    waitUntil: "domcontentloaded",
    timeout: LINKEDIN_NAV_TIMEOUT_MS,
  });

  // Wait for network to settle and for the description container to appear
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(LINKEDIN_SETTLE_MS);

  // Wait for job description content to actually render
  await page
    .waitForSelector(
      ".jobs-description__content, .jobs-box__html-content, .jobs-description-content__text",
      { timeout: 5000 }
    )
    .catch(() => undefined);

  await expandJobDescription(page);

  let title = await firstNonEmptyText(page, [
    "h1",
    ".t-24.job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title",
    ".job-details-jobs-unified-top-card__job-title",
  ]);

  let company = await firstNonEmptyText(page, [
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name a",
    ".jobs-unified-top-card__company-name",
    ".topcard__org-name-link",
  ]);

  // Fallback: extract title and company from the page <title> tag.
  // LinkedIn page titles follow the pattern "Job Title | Company | LinkedIn"
  if (!title || !company) {
    const pageTitle = await page.title().catch(() => "");
    const parts = pageTitle.split("|").map((s) => s.trim()).filter(Boolean);
    // Drop the trailing "LinkedIn" segment
    const meaningful = parts.filter((p) => p.toLowerCase() !== "linkedin");
    if (!title && meaningful[0]) title = meaningful[0];
    if (!company && meaningful[1]) company = meaningful[1];
  }

  const location = await firstNonEmptyText(page, [
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__bullet",
    ".jobs-unified-top-card__subtitle-primary-grouping",
  ]);

  const postedText = await firstNonEmptyText(page, [
    ".job-details-jobs-unified-top-card__tertiary-description-container",
    ".jobs-unified-top-card__posted-date",
    ".jobs-details-top-card__job-info",
  ]);

  let description = await firstNonEmptyText(page, [
    ".jobs-description__content",
    ".jobs-box__html-content",
    ".jobs-description-content__text",
    ".jobs-search__job-details--container",
    ".jobs-description",
    "[data-job-detail-container]",
    ".job-view-layout jobs-search-two-pane__layout",
  ]);

  if (!description || description.length < 200) {
    description = await extractBodyTextFallback(page);
  }

  const applyUrl = await firstNonEmptyHref(page, [
    "a.jobs-apply-button",
    "a[data-control-name='jobdetails_topcard_inapply']",
    "a[href*='offsite-job']",
  ]);

  const easyApply =
    (await page.locator("button.jobs-apply-button").first().isVisible().catch(() => false)) ||
    (await page.locator("button[aria-label*='Easy Apply']").first().isVisible().catch(() => false));

  const currentUrl = page.url().split("?")[0];
  const match = currentUrl.match(/\/jobs\/view\/(\d+)/);
  const jobId = match?.[1] ?? fallbackJobId;

  if (!title || !company || !description || description.length < 200) {
    const diagnostics = await collectLinkedInPageDiagnostics(page);
    throw new Error(
      `Could not extract enough LinkedIn job detail from ${jobUrl}. ` +
        `finalUrl=${diagnostics.finalUrl} pageTitle=${JSON.stringify(diagnostics.pageTitle)} ` +
        `title=${JSON.stringify(diagnostics.titleText)} company=${JSON.stringify(diagnostics.companyText)} ` +
        `descriptionLength=${diagnostics.descriptionLength} bodyPreview=${JSON.stringify(diagnostics.bodyPreview)}`
    );
  }

  return {
    jobId,
    title,
    company,
    location,
    postedText,
    jobUrl: currentUrl,
    applyUrl,
    easyApply,
    description,
  };
}

async function expandJobDescription(page: Page): Promise<void> {
  const expandSelectors = [
    "button[aria-label*='Click to see more description']",
    "button[aria-label*='See more description']",
    "button[aria-label*='see more description']",
    "button.inline-show-more-text__button",
    ".jobs-description__footer-button button",
    "button.jobs-description__footer-button",
  ];

  for (const selector of expandSelectors) {
    const button = page.locator(selector).first();
    const visible = await button.isVisible().catch(() => false);

    if (!visible) {
      continue;
    }

    await button.click().catch(() => undefined);
    await page.waitForTimeout(250);
    return;
  }
}

async function firstNonEmptyText(page: Page, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const text = (await locator.textContent({ timeout: LOCATOR_TIMEOUT_MS }).catch(() => null))?.trim();

    if (text) {
      return text.replace(/\s+/g, " ").trim();
    }
  }

  return "";
}

async function firstNonEmptyHref(page: Page, selectors: string[]): Promise<string | undefined> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const href = (await locator.getAttribute("href", { timeout: LOCATOR_TIMEOUT_MS }).catch(() => null))?.trim();

    if (href) {
      return href;
    }
  }

  return undefined;
}

async function extractBodyTextFallback(page: Page): Promise<string> {
  const bodyText = await page.locator("body").innerText().catch(() => "");

  return bodyText
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function collectLinkedInPageDiagnostics(page: Page): Promise<LinkedInPageDiagnostics> {
  const finalUrl = page.url();
  const pageTitle = await page.title().catch(() => "");
  const titleText = await firstNonEmptyText(page, [
    "h1",
    ".jobs-unified-top-card__job-title",
    ".job-details-jobs-unified-top-card__job-title",
  ]);
  const companyText = await firstNonEmptyText(page, [
    ".jobs-unified-top-card__company-name",
    ".job-details-jobs-unified-top-card__company-name",
    ".topcard__org-name-link",
  ]);
  const bodyPreview = (await extractBodyTextFallback(page)).slice(0, 400);

  return {
    finalUrl,
    titleText,
    companyText,
    descriptionLength: bodyPreview.length,
    pageTitle,
    bodyPreview,
  };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${JOB_PROCESS_TIMEOUT_MS}ms`));
    }, JOB_PROCESS_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
