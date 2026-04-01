import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { env } from "./env.js";

export type WithBrowserOptions = {
  storageStatePath?: string;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function withBrowser<T>(
  fn: (page: Page, browser: Browser, context: BrowserContext) => Promise<T>,
  options: WithBrowserOptions = {}
): Promise<T> {
  const browser = await chromium.launch({ headless: env.PLAYWRIGHT_HEADLESS });
  const storageStatePath = options.storageStatePath;
  const hasStoredState = storageStatePath ? await fileExists(storageStatePath) : false;

  const context = await browser.newContext(
    hasStoredState && storageStatePath
      ? { storageState: storageStatePath }
      : undefined
  );

  const page = await context.newPage();

  try {
    return await fn(page, browser, context);
  } finally {
    if (storageStatePath) {
      await mkdir(path.dirname(storageStatePath), { recursive: true });
      await context.storageState({ path: storageStatePath });
    }

    await context.close();
    await browser.close();
  }
}
