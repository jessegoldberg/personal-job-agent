type ResumeDocumentOptions = {
  title: string;
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

// Known section header names to detect in plain-text output
const SECTION_HEADERS = new Set([
  "work experience",
  "areas of focus",
  "education",
  "certifications",
  "skills",
  "summary",
  "professional summary",
  "experience",
]);

// Known role subsection names (partial match)
const SUBSECTION_KEYWORDS = [
  "enterprise",
  "product leadership",
  "platform",
  "reliability",
  "operational",
  "organizational",
  "security",
  "identity",
  "integration",
  "cross-functional",
  "solution architecture",
  "pre-sales",
  "infrastructure",
  "cloud",
  "automation",
  "impact",
];

/**
 * Detects whether the HTML was generated from properly-headed markdown
 * (contains h1/h2/h3 tags) or from plain-text markdown (all <p> tags).
 */
function isPlainTextOutput(html: string): boolean {
  return !/<h[123]/i.test(html);
}

/**
 * Fixes plain-paragraph HTML output by detecting structural patterns
 * and converting them to proper semantic elements.
 */
function restructurePlainHtml(html: string): string {
  // Split into blocks on paragraph boundaries
  const blocks = html.split(/(?=<p>)|(?<=<\/p>)/).filter((b) => b.trim());

  const out: string[] = [];
  let i = 0;
  let inHeader = false;
  let headerLines: string[] = [];

  while (i < blocks.length) {
    const block = blocks[i].trim();

    // Strip outer <p>...</p> to get inner content
    const inner = block.replace(/^<p>/, "").replace(/<\/p>$/, "").trim();
    const innerText = inner.replace(/<[^>]+>/g, "").trim();
    const lowerText = innerText.toLowerCase();

    // ── Candidate name: first non-empty paragraph, no special chars ──────
    if (i === 0 && innerText && !innerText.includes("|") && innerText.split(" ").length <= 4) {
      inHeader = true;
      out.push(`<div class="resume-header"><h1>${inner}</h1>`);
      i++;
      continue;
    }

    // ── Contact info + tagline block (after name) ─────────────────────────
    if (inHeader) {
      // The LLM often emits contact info as a single <p> with <br> separators,
      // then the tagline as the next <p>. Handle both patterns.

      if (inner.includes("<br>")) {
        // Split on <br> — last part may be the tagline if it contains |
        const parts = inner
          .split(/<br\s*\/?>/i)
          .map((p) => p.trim())
          .filter(Boolean);

        // Separate contact items from any trailing tagline
        const taglineIdx = parts.findIndex(
          (p) => p.includes("|") || /architect|engineer|manager|leader|consultant/i.test(p.replace(/<[^>]+>/g, ""))
        );

        let contactParts: string[];
        let taglinePart: string | null = null;

        if (taglineIdx !== -1) {
          contactParts = parts.slice(0, taglineIdx);
          taglinePart = parts[taglineIdx];
        } else {
          contactParts = parts;
        }

        if (contactParts.length > 0) {
          const BULLET = " \x26#8226; ";
          out.push(`<p class="contact-line">${contactParts.join(BULLET)}</p>`);
        }

        if (taglinePart) {
          out.push(`</div>`);
          out.push(`<p class="resume-tagline">${taglinePart}</p>`);
          inHeader = false;
        }

        i++;
        continue;
      }

      // Plain single-line contact item (city, phone, email, linkedin)
      const isContactItem =
        /\d{3}/.test(innerText) ||
        innerText.includes("@") ||
        innerText.includes("linkedin") ||
        /^[A-Za-z\s]+,\s+[A-Z]{2}$/.test(innerText);

      if (isContactItem) {
        // Accumulate into a single contact line on next pass — for now emit
        // as a contact-line so CSS centers it; multiple will stack, but the
        // br-path above is the common case
        const BULLET = " \x26#8226; ";
        out.push(`<p class="contact-line">${innerText}</p>`);
        i++;
        continue;
      }

      // Tagline: contains | or professional title keywords
      if (innerText.includes("|") || /architect|engineer|manager|leader|consultant/i.test(innerText)) {
        out.push(`</div>`);
        out.push(`<p class="resume-tagline">${inner}</p>`);
        inHeader = false;
        i++;
        continue;
      }

      // Anything else after the name — close header and emit as body
      out.push(`</div>`);
      inHeader = false;
      out.push(`<p>${inner}</p>`);
      i++;
      continue;
    }

    // ── Section headers ───────────────────────────────────────────────────
    if (SECTION_HEADERS.has(lowerText)) {
      out.push(`<h2>${innerText}</h2>`);
      i++;
      continue;
    }

    // ── Role subsection headers ───────────────────────────────────────────
    if (
      SUBSECTION_KEYWORDS.some((k) => lowerText.includes(k)) &&
      innerText.length < 60 &&
      !block.includes("<ul>") &&
      !block.includes("<li>")
    ) {
      out.push(`<h4>${innerText}</h4>`);
      i++;
      continue;
    }

    // ── Company + title + date block (contains <br>) ──────────────────────
    // Pattern: "Company Name<br>Job Title<br>Date"
    // OR: "Company Name<br>Job Title<br>City<br>Date"
    if (inner.includes("<br>") && !innerText.includes("@") && !innerText.includes("linkedin")) {
      const parts = inner
        .split(/<br\s*\/?>/i)
        .map((p) => p.trim())
        .filter(Boolean);

      // Check if last part looks like a date range
      const lastPart = parts[parts.length - 1].replace(/<[^>]+>/g, "").trim();
      const isDateLike = /\d{2}\/\d{4}|\d{4}.*-.*(\d{4}|present)/i.test(lastPart);

      if (parts.length >= 2 && isDateLike) {
        // Company name = first part
        out.push(`<h3>${parts[0]}</h3>`);

        // Middle parts (title, optional city)
        const middleParts = parts.slice(1, -1);
        const titlePart = middleParts[0] || "";
        const extraParts = middleParts.slice(1);

        // Build role-header flex row
        const titleHtml = titlePart.startsWith("<strong>")
          ? titlePart
          : `<strong>${titlePart}</strong>`;
        const extra = extraParts.length > 0 ? ` &middot; ${extraParts.join(" &middot; ")}` : "";
        out.push(
          `<p class="role-header">` +
            `<span class="role-title">${titleHtml}${extra}</span>` +
            `<span class="role-date">${lastPart}</span>` +
            `</p>`
        );
        i++;
        continue;
      }
    }

    // ── Areas of Focus skill lines ─────────────────────────────────────────
    // Pattern: paragraph starting with bold label followed by colon + skills
    if (/^<strong>[^<]+<\/strong>:?\s/i.test(inner) || inner.includes("<br>") === false) {
      const colonMatch = inner.match(/^(<strong>[^<]+<\/strong>):?\s+(.+)$/s);
      if (colonMatch) {
        out.push(
          `<p class="focus-line">` +
            `<span class="focus-label">${colonMatch[1]}:</span>` +
            `<span class="focus-skills">${colonMatch[2].trim()}</span>` +
            `</p>`
        );
        i++;
        continue;
      }
    }

    // ── Pass through everything else (ul, li, plain p) ───────────────────
    out.push(block);
    i++;
  }

  // Close header if still open
  if (inHeader) out.push(`</div>`);

  // Wrap consecutive focus-line paragraphs in a .focus-grid div
  const joined = out.join("\n");
  const wrappedFocusGrid = joined.replace(
    /(<p class="focus-line">[\s\S]*?<\/p>)(\s*<p class="focus-line">[\s\S]*?<\/p>)*/g,
    (match) => `<div class="focus-grid">${match}</div>`
  );

  return wrapH2Sections(wrappedFocusGrid);
}

/**
 * Post-processes properly-structured HTML (has h1/h2/h3 headings).
 */
function wrapH2Sections(html: string): string {
  const parts = html.split(/(?=<h2>)/);

  return parts
    .map((part) => {
      if (!part.startsWith("<h2>")) {
        return part;
      }

      const headingMatch = part.match(/^<h2>([^<]+)<\/h2>/);
      const headingText = headingMatch?.[1]?.trim().toLowerCase() ?? "";
      const extraClass =
        headingText === "areas of focus" ? " resume-section-focus" : "";

      return `<section class="resume-section${extraClass}">${part}</section>`;
    })
    .join("");
}

function postProcessStructuredHtml(html: string): string {
  const BULLET = " \x26#8226; ";

  // ── 1. Header: wrap h1 + contact paragraph in .resume-header ────────────
  // The contact block is a single <p> with <br>-separated items, e.g.:
  //   <p>Bradenton, FL<br>\n(941) 773-1067<br>\n...</p>
  // We split on <br>, strip trailing whitespace/links, and join with bullets.
  html = html.replace(
    /(<h1>[^<]*<\/h1>)\n?(<p>[\s\S]*?<\/p>)/,
    (_match, h1Tag, contactPTag) => {
      // Extract inner content of the <p>
      const inner = contactPTag.replace(/^<p>/, "").replace(/<\/p>$/, "");

      // Split on <br> (with optional newline after)
      const parts = inner
        .split(/<br\s*\/?>\n?/i)
        .map((s: string) => s.trim())
        .filter(Boolean);

      // Separate out any trailing tagline (contains | or title keywords)
      // Contact items come first; if the last part looks like a tagline, peel it off
      let contactParts = parts;
      let taglinePart: string | null = null;
      const lastPart = parts[parts.length - 1] ?? "";
      if (
        lastPart.includes("|") ||
        /architect|engineer|manager|leader|consultant/i.test(lastPart)
      ) {
        contactParts = parts.slice(0, -1);
        taglinePart = lastPart;
      }

      const contactLine =
        contactParts.length > 0
          ? `<p class="contact-line">${contactParts.join(BULLET)}</p>`
          : "";

      // Tagline goes OUTSIDE the header div so it renders left-aligned below
      const taglineHtml = taglinePart
        ? `</div>\n<p class="resume-tagline">${taglinePart}</p>`
        : "";

      return `<div class="resume-header">${h1Tag}${contactLine}${taglineHtml || "</div>"}`;
    }
  );

  // If the header div was closed above with a tagline we're done with it.
  // Otherwise convert the first h2 (the professional tagline) to .resume-tagline.
  // We only want to convert the FIRST h2 that immediately follows the header block.
  let firstH2Done = false;
  html = html.replace(/<h2>([^<]*)<\/h2>/g, (match, text) => {
    if (!firstH2Done) {
      firstH2Done = true;
      return `<p class="resume-tagline">${text.trim()}</p>`;
    }
    return match;
  });

  // ── 1b. Wrap consecutive focus-line paragraphs in a .focus-grid div ───────
  html = html.replace(
    /(<p class="focus-line">[\s\S]*?<\/p>)(\s*<p class="focus-line">[\s\S]*?<\/p>)*/g,
    (match) => `<div class="focus-grid">${match}</div>`
  );

  // ── 2. Role title + date rows ─────────────────────────────────────────────
  // Pattern from markdown "**Title**  \nDate" → <p><strong>Title</strong><br>\nDate</p>
  // Also handles city line between title and date:
  //   <p><strong>Title</strong><br>\nCity, ST<br>\nDate</p>
  html = html.replace(
    /<p>(<strong>[^<]+<\/strong>)((?:<br>\n?[^<]+)+)<\/p>/g,
    (_match, strongTitle, rest) => {
      const parts = rest
        .split(/<br\s*\/?>\n?/i)
        .map((s: string) => s.trim())
        .filter(Boolean);

      if (parts.length === 0) return _match;

      const lastPart = parts[parts.length - 1];
      const isDateLike = /\d{2}\/\d{4}|\d{4}.*[-–].*(\d{4}|present)/i.test(lastPart);

      if (isDateLike) {
        // Extra middle parts (e.g. city) get appended to the title span
        const middleParts = parts.slice(0, -1);
        const extra =
          middleParts.length > 0
            ? ` <span class="role-location">\x26middot; ${middleParts.join(" \x26middot; ")}</span>`
            : "";
        return (
          `<p class="role-header">` +
          `<span class="role-title">${strongTitle}${extra}</span>` +
          `<span class="role-date">${lastPart}</span>` +
          `</p>`
        );
      }

      // Not a date — treat as Areas of Focus: **Label**<br>skills
      return (
        `<p class="focus-line">` +
        `<span class="focus-label">${strongTitle}:</span>` +
        `<span class="focus-skills">${parts.join(", ")}</span>` +
        `</p>`
      );
    }
  );

  return wrapH2Sections(html);
}

export function buildResumeHtml({
  title,
  bodyHtml,
  stylesheet,
}: ResumeDocumentOptions): string {
  const safeTitle = escapeHtml(title);

  const processedHtml = isPlainTextOutput(bodyHtml)
    ? restructurePlainHtml(bodyHtml)
    : postProcessStructuredHtml(bodyHtml);

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
    '  <main class="resume-page">',
    processedHtml,
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");
}
