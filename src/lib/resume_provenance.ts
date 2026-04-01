import path from "node:path";
import { z } from "zod";
import { readText } from "./fs.js";
import { complete } from "./model_client.js";
import { logger } from "./logger.js";

const provenanceSchema = z.object({
  approved: z.boolean(),
  summary: z.string(),
  unsupportedClaims: z.array(z.string()),
  claims: z.array(
    z.object({
      claimId: z.string(),
      sourceIds: z.array(z.string()),
      supported: z.boolean(),
      notes: z.string(),
    })
  ),
});

export type ResumeProvenanceAudit = z.infer<typeof provenanceSchema>;

type SourceItem = {
  id: string;
  source: string;
  text: string;
};

type ClaimItem = {
  id: string;
  text: string;
};

type AuditInput = {
  baselineResume: string;
  masterResume: string;
  accomplishments: string;
  tailoredResume: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sentenceSplit(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function buildResumeSourceItems(markdown: string, prefix: string, source: string): SourceItem[] {
  const items: SourceItem[] = [];
  const lines = markdown.split("\n");
  let index = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line === "---") continue;
    if (/^\d{2}\/\d{4}\s*-\s*(?:\d{2}\/\d{4}|present)$/i.test(line)) continue;
    if (/^\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}$/.test(line)) continue;
    if (/@/.test(line) || /linkedin\.com/i.test(line)) continue;
    if (/^[A-Za-z .'-]+,\s*[A-Z]{2}$/.test(line)) continue;

    const text = line.startsWith("- ") ? line.slice(2).trim() : line;
    if (!text) continue;

    items.push({
      id: `${prefix}-${String(index).padStart(3, "0")}`,
      source,
      text,
    });
    index += 1;
  }

  return items;
}

function buildAccomplishmentSourceItems(raw: string): SourceItem[] {
  const parsed = JSON.parse(raw) as Array<{ id: string; bullet?: string }>;
  return parsed
    .filter((item) => item.id && item.bullet)
    .map((item) => ({
      id: item.id,
      source: "accomplishments",
      text: normalizeWhitespace(item.bullet ?? ""),
    }));
}

function extractClaimItems(markdown: string): ClaimItem[] {
  const lines = markdown.split("\n");
  const claims: ClaimItem[] = [];
  let summaryMode = false;
  let summaryParagraph: string[] = [];
  let index = 1;

  const pushClaim = (text: string) => {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return;
    claims.push({
      id: `claim-${String(index).padStart(3, "0")}`,
      text: normalized,
    });
    index += 1;
  };

  const flushSummary = () => {
    if (summaryParagraph.length === 0) return;
    for (const sentence of sentenceSplit(summaryParagraph.join(" "))) {
      pushClaim(sentence);
    }
    summaryParagraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "## Summary") {
      flushSummary();
      summaryMode = true;
      continue;
    }

    if (line.startsWith("## ") && line !== "## Summary") {
      flushSummary();
      summaryMode = false;
    }

    if (!line) {
      flushSummary();
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (line === "---") {
      continue;
    }

    if (/^\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}$/.test(line)) {
      continue;
    }

    if (/@/.test(line) || /linkedin\.com/i.test(line)) {
      continue;
    }

    if (/^[A-Za-z .'-]+,\s*[A-Z]{2}$/.test(line)) {
      continue;
    }

    if (/^\d{2}\/\d{4}\s*-\s*(?:\d{2}\/\d{4}|present)$/i.test(line)) {
      continue;
    }

    if (summaryMode) {
      summaryParagraph.push(line);
      continue;
    }

    if (line.startsWith("- ")) {
      pushClaim(line.slice(2));
      continue;
    }

    if (line.startsWith("**") && line.includes("**")) {
      pushClaim(line);
      continue;
    }

    if (!line.startsWith("### ") && !line.startsWith("#### ")) {
      pushClaim(line);
    }
  }

  flushSummary();
  return claims;
}

function tryParseAudit(text: string): ResumeProvenanceAudit | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  const candidates = [cleaned];
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      return provenanceSchema.parse(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  return null;
}

async function normalizeAudit(rawText: string): Promise<ResumeProvenanceAudit | null> {
  const systemPrompt = [
    "Convert the provided provenance notes into strict JSON only.",
    "Do not add markdown, headings, explanations, or code fences.",
    "Return exactly one JSON object with these keys:",
    "{",
    '  "approved": boolean,',
    '  "summary": string,',
    '  "unsupportedClaims": string[],',
    '  "claims": [{ "claimId": string, "sourceIds": string[], "supported": boolean, "notes": string }]',
    "}",
    "Be conservative. If unclear, prefer approved=false and supported=false for uncertain claims.",
  ].join("\n");

  const normalizedText = await complete(
    "tailor",
    systemPrompt,
    `Provenance notes to convert:\n\n${rawText}`
  );

  return tryParseAudit(normalizedText);
}

function validateSourceIds(audit: ResumeProvenanceAudit, sourceIds: Set<string>): ResumeProvenanceAudit {
  const claims = audit.claims.map((claim) => {
    const validSourceIds = claim.sourceIds.filter((sourceId) => sourceIds.has(sourceId));
    const supported = claim.supported && validSourceIds.length > 0;
    const notes =
      validSourceIds.length === claim.sourceIds.length
        ? claim.notes
        : normalizeWhitespace(`${claim.notes} Invalid source IDs were removed during verification.`);

    return {
      ...claim,
      sourceIds: validSourceIds,
      supported,
      notes,
    };
  });

  const unsupportedClaims = Array.from(
    new Set([
      ...audit.unsupportedClaims,
      ...claims.filter((claim) => !claim.supported).map((claim) => claim.claimId),
    ])
  );

  return {
    approved: audit.approved && unsupportedClaims.length === 0,
    summary: audit.summary,
    unsupportedClaims,
    claims,
  };
}

export async function auditResumeProvenance(input: AuditInput): Promise<{
  audit: ResumeProvenanceAudit;
  sourceCatalog: SourceItem[];
  claims: ClaimItem[];
}> {
  const promptPath = path.join("src", "prompts", "validate-resume-provenance.txt");
  const systemPrompt = await readText(promptPath);

  const sourceCatalog = [
    ...buildResumeSourceItems(input.baselineResume, "baseline", "baseline_resume"),
    ...buildResumeSourceItems(input.masterResume, "master", "master_resume"),
    ...buildAccomplishmentSourceItems(input.accomplishments),
  ];
  const claims = extractClaimItems(input.tailoredResume);

  const userContent = [
    "Source catalog:",
    JSON.stringify(sourceCatalog, null, 2),
    "",
    "Claim units:",
    JSON.stringify(claims, null, 2),
  ].join("\n");

  const rawOutput = await complete("tailor", systemPrompt, userContent);
  const parsed = tryParseAudit(rawOutput);
  const sourceIds = new Set(sourceCatalog.map((item) => item.id));

  if (parsed) {
    return {
      audit: validateSourceIds(parsed, sourceIds),
      sourceCatalog,
      claims,
    };
  }

  logger.warn(
    { rawOutput: rawOutput.slice(0, 1000) },
    "Resume provenance audit did not return valid JSON on first pass"
  );

  const normalized = await normalizeAudit(rawOutput);
  if (normalized) {
    return {
      audit: validateSourceIds(normalized, sourceIds),
      sourceCatalog,
      claims,
    };
  }

  logger.warn(
    { rawOutput: rawOutput.slice(0, 1000) },
    "Resume provenance audit did not return valid JSON after normalization"
  );

  return {
    audit: {
      approved: false,
      summary: "Provenance audit output could not be parsed reliably.",
      unsupportedClaims: claims.map((claim) => claim.id),
      claims: claims.map((claim) => ({
        claimId: claim.id,
        sourceIds: [],
        supported: false,
        notes: "Audit output could not be parsed; manual review is required.",
      })),
    },
    sourceCatalog,
    claims,
  };
}
