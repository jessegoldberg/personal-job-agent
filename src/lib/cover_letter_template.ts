type CoverLetterDocumentOptions = {
  name: string;
  contactItems: string[];
  bodyHtml: string;
  stylesheet: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "\x26amp;")
    .replaceAll("<", "\x26lt;")
    .replaceAll(">", "\x26gt;")
    .replaceAll('"', "\x26quot;")
    .replaceAll("'", "\x26#39;");
}

/**
 * Parses name and contact items out of a master resume markdown string.
 * Expects the standard format:
 *   # Name
 *   City, ST
 *   phone
 *   email
 *   linkedin
 */
export function parseResumeHeader(markdown: string): { name: string; contactItems: string[] } {
  const lines = markdown.split("\n").map((l) => l.trimEnd());

  let name = "";
  const contactItems: string[] = [];
  let foundH1 = false;
  let collectingContact = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!foundH1 && trimmed.startsWith("# ")) {
      name = trimmed.replace(/^#\s+/, "").trim();
      foundH1 = true;
      collectingContact = true;
      continue;
    }

    if (collectingContact) {
      // Stop collecting when we hit the next heading or a blank line after items
      if (trimmed.startsWith("#")) break;
      // Skip pure blank lines only if we have no contact items yet
      if (trimmed === "") {
        if (contactItems.length > 0) break;
        continue;
      }
      // Strip trailing spaces (markdown line-break syntax)
      const item = trimmed.replace(/\s+$/, "");
      if (item) contactItems.push(item);
    }
  }

  return { name, contactItems };
}

export function buildCoverLetterHtml({
  name,
  contactItems,
  bodyHtml,
  stylesheet,
}: CoverLetterDocumentOptions): string {
  const safeTitle = escapeHtml(`Cover Letter – ${name}`);
  const BULLET = " \x26#8226; ";
  const contactLine = contactItems.length > 0
    ? `<p class="contact-line">${contactItems.join(BULLET)}</p>`
    : "";

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeTitle}</title>`,
    "  <style>",
    stylesheet,
    "  </style>",
    "</head>",
    "<body>",
    '  <main class="resume-page cover-letter-page">',
    '    <div class="resume-header">',
    `      <h1>${escapeHtml(name)}</h1>`,
    `      ${contactLine}`,
    "    </div>",
    '    <div class="cover-letter-body">',
    bodyHtml,
    "    </div>",
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");
}