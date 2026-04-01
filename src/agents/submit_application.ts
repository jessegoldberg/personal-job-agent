import path from "node:path";
import { withBrowser } from "../lib/playwright.js";

async function main() {
  const url = process.argv[2];
  if (!url) {
    throw new Error("Usage: npm run apply:dry -- <application-url>");
  }

  await withBrowser(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    console.log("Opened application page in dry-run mode:", url);
    await page.screenshot({ path: path.join("output", "apply-dry-run.png"), fullPage: true });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
