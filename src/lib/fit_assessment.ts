import path from "node:path";
import { readText } from "./fs.js";
import { complete } from "./model_client.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import type { FitAssessment } from "../types/fit.js";

type ResumeStrategy = {
  defaultResume: string;
  roleFamilies: Record<
    string,
    {
      resumePath: string;
      keywords: string[];
    }
  >;
};

type ResumeRecommendation = {
  recommendedResumePath: string;
  recommendedResumeReason: string;
};

type ParsedFitAssessment = Omit<
  FitAssessment,
  "recommendedResumePath" | "recommendedResumeReason"
>;

export type AssessedFitResult = {
  fitReport: FitAssessment;
  rawOutputText: string;
};

type RequirementPattern = {
  label: string;
  patterns: RegExp[];
};

type RequirementImportance = "required" | "preferred";

type ExtractedRequirement = {
  label: string;
  importance: RequirementImportance;
};

type JobFamilyName =
  | "technical_product"
  | "solutions_engineering"
  | "solutions_architecture"
  | "data_analytics"
  | "cybersecurity"
  | "media_workflows"
  | "software_engineering";

type JobFamilyDefinition = {
  name: JobFamilyName;
  jobPatterns: RegExp[];
  minimumEvidence: string[];
  scoreCapWithoutEvidence: number;
  cautionCapWithoutEvidence?: number;
};

type CalibrationResult = {
  calibrated: ParsedFitAssessment;
  missingHardRequirements: string[];
  matchedHardRequirements: string[];
  dominantJobFamilies: JobFamilyName[];
  missingFamilyEvidence: string[];
  matchedFamilyEvidence: string[];
};

type JobFamilyScore = {
  name: JobFamilyName;
  score: number;
};

type RoleCalibrationContext = {
  effectiveFamilies: JobFamilyName[];
  suppressedFamilies: JobFamilyName[];
  roleFunctionFamily?: JobFamilyName;
  isCustomerFacingSecurityVendorRole: boolean;
  isCybersecurityPractitionerRole: boolean;
};

const HARD_REQUIREMENT_PATTERNS: RequirementPattern[] = [
  { label: "sql", patterns: [/\bsql\b/i, /\bpostgres(?:ql)?\b/i, /\bmysql\b/i, /\bsnowflake\b/i] },
  { label: "python", patterns: [/\bpython\b/i] },
  { label: "software development", patterns: [/\bsoftware engineer(?:ing)?\b/i, /\bsoftware developer\b/i, /\bfull.?stack\b/i, /\bbackend engineer(?:ing)?\b/i, /\bfrontend engineer(?:ing)?\b/i, /\bwrite code\b/i, /\bproduction code\b/i, /\bcode reviews?\b/i] },
  { label: "javascript", patterns: [/\bjavascript\b/i, /\btypescript\b/i, /\bnode\.?js\b/i, /\breact\b/i, /\bvue\b/i, /\bangular\b/i] },
  { label: "java", patterns: [/\bjava\b/i, /\bspring boot\b/i, /\bjvm\b/i] },
  { label: "golang", patterns: [/\bgolang\b/i, /\bgo lang\b/i] },
  { label: "rust", patterns: [/\brust\b/i] },
  { label: "c++ or c#", patterns: [/\bc\+\+\b/i, /\bc#\b/i, /\b\.net\b/i] },
  { label: "statistics", patterns: [/\bstatistics?\b/i, /\bstatistical analysis\b/i, /\bhypothesis testing\b/i] },
  { label: "a/b testing", patterns: [/\ba\/b testing\b/i, /\bexperimentation\b/i, /\bexperiment design\b/i] },
  { label: "dashboards", patterns: [/\bdashboard(?:s)?\b/i, /\bbi reporting\b/i, /\bdata visualization\b/i] },
  { label: "tableau", patterns: [/\btableau\b/i] },
  { label: "looker", patterns: [/\blooker\b/i] },
  { label: "power bi", patterns: [/\bpower bi\b/i] },
  { label: "excel", patterns: [/\bexcel\b/i] },
  { label: "data quality", patterns: [/\bdata quality\b/i, /\bdata validation\b/i, /\bdata integrity\b/i] },
  { label: "quality assurance", patterns: [/\bquality assurance\b/i, /\bqa\b/i, /\btest planning\b/i, /\btest strategy\b/i] },
  { label: "machine learning", patterns: [/\bmachine learning\b/i, /\bml models?\b/i, /\bmodel training\b/i] },
  { label: "security operations", patterns: [/\bsoc\b/i, /\bsiem\b/i, /\bthreat detection\b/i, /\bincident response\b/i, /\bmdr\b/i] },
  { label: "digital forensics", patterns: [/\bdigital forensics\b/i, /\bftk\b/i, /\bforensic\b/i] },
  { label: "compliance frameworks", patterns: [/\biso 27001\b/i, /\bnist\b/i, /\bcis controls?\b/i, /\bgdpr\b/i] },
  { label: "sales engineering", patterns: [/\bsales engineer(?:ing)?\b/i, /\bsolutions engineer(?:ing)?\b/i, /\bpre-sales\b/i, /\bpresales\b/i] },
  { label: "solution architecture", patterns: [/\bsolution architecture\b/i, /\bsolutions architect\b/i, /\bsolution design\b/i] },
  { label: "apis", patterns: [/\bapi\b/i, /\bapis\b/i, /\brest\b/i] },
  { label: "sso", patterns: [/\bsso\b/i, /\bsaml\b/i, /\boauth\b/i] },
  { label: "aws", patterns: [/\baws\b/i, /\bamazon web services\b/i] },
  { label: "azure", patterns: [/\bazure\b/i, /\bmicrosoft azure\b/i] },
  { label: "gcp", patterns: [/\bgcp\b/i, /\bgoogle cloud\b/i, /\bgoogle cloud platform\b/i] },
  { label: "docker", patterns: [/\bdocker\b/i, /\bcontainer(?:s|ized)?\b/i] },
  { label: "linux", patterns: [/\blinux\b/i, /\bubuntu\b/i, /\bdebian\b/i] },
  { label: "networking", patterns: [/\bnetwork(?:ing)?\b/i, /\btls\b/i, /\bdns\b/i] },
  { label: "programmatic advertising", patterns: [/\bprogrammatic\b/i, /\badtech\b/i] },
  { label: "rtsp", patterns: [/\brtsp\b/i, /\blive stream(?:ing)?\b/i] },
  { label: "premiere", patterns: [/\badobe premiere\b/i, /\bpremiere\b/i] },
  { label: "resolve", patterns: [/\bresolve\b/i, /\bda vinci resolve\b/i] },
  { label: "avid", patterns: [/\bavid\b/i] },
  { label: "asset management", patterns: [/\basset management\b/i, /\bmedia asset\b/i, /\barchiving\b/i] },
  { label: "warehouse management", patterns: [/\bwarehouse management\b/i, /\bwms\b/i, /\bfulfillment\b/i, /\bsupply chain\b/i] },
  { label: "association management", patterns: [/\bassociation management\b/i, /\bmembership\b/i, /\bassociation workflows?\b/i, /\bams\b/i] },
];

const REQUIREMENT_SECTION_PATTERNS = [
  /requirements/i,
  /qualifications/i,
  /responsibilities/i,
  /what you will do/i,
  /what you'll do/i,
  /ideal candidate/i,
  /must have/i,
  /nice to have/i,
  /preferred/i,
  /who you are/i,
  /experience/i,
  /what you'll bring/i,
];

const OPTIONAL_SECTION_PATTERNS = [
  /nice to have/i,
  /preferred/i,
  /bonus/i,
  /plus/i,
];

const CYBERSECURITY_PRACTITIONER_PATTERNS = [
  /\bdigital forensics\b/i,
  /\bforensic\b/i,
  /\bsoc\b/i,
  /\bsiem\b/i,
  /\bthreat detection\b/i,
  /\bincident response\b/i,
  /\bsecurity analyst\b/i,
  /\bdetection engineer(?:ing)?\b/i,
  /\bblue team\b/i,
  /\bsecurity operations\b/i,
];

const CYBERSECURITY_PRACTITIONER_TITLE_PATTERNS = [
  /\bsecurity operations\b/i,
  /\bsecurity analyst\b/i,
  /\bincident responder\b/i,
  /\bdetection engineer(?:ing)?\b/i,
  /\bdigital forensics\b/i,
  /\bsoc analyst\b/i,
];

const CUSTOMER_FACING_SOLUTION_PATTERNS = [
  /\bsolutions engineer(?:ing)?\b/i,
  /\bsales engineer(?:ing)?\b/i,
  /\bpre-sales\b/i,
  /\bpresales\b/i,
  /\bdemonstrations?\b/i,
  /\bproof of concept\b/i,
  /\btechnical discovery\b/i,
  /\brfp\b/i,
  /\bprospects?\b/i,
  /\bcustomers?\b/i,
  /\bevaluation\b/i,
];

const JOB_FAMILY_DEFINITIONS: JobFamilyDefinition[] = [
  {
    name: "software_engineering" as JobFamilyName,
    jobPatterns: [
      /\bsoftware engineer(?:ing)?\b/i,
      /\bsoftware developer\b/i,
      /\bfull.?stack\b/i,
      /\bbackend engineer(?:ing)?\b/i,
      /\bfrontend engineer(?:ing)?\b/i,
      /\bcode reviews?\b/i,
      /\bpull requests?\b/i,
      /\bgit(?:hub|lab)?\b/i,
      /\bci\/cd\b/i,
      /\btest.driven\b/i,
      /\bunit tests?\b/i,
      /\bdeployment pipeline\b/i,
    ],
    minimumEvidence: ["software development", "python", "javascript", "java"],
    scoreCapWithoutEvidence: 38,
    cautionCapWithoutEvidence: 44,
  },
  {
    name: "data_analytics",
    jobPatterns: [
      /\bsql\b/i,
      /\bdashboards?\b/i,
      /\btableau\b/i,
      /\blooker\b/i,
      /\bpower bi\b/i,
      /\bstatistical\b/i,
      /\bexperimentation\b/i,
      /\ba\/b testing\b/i,
      /\bdata quality\b/i,
      /\banalytics?\b/i,
    ],
    minimumEvidence: ["sql", "dashboards", "statistics", "a/b testing", "data quality"],
    scoreCapWithoutEvidence: 54,
    cautionCapWithoutEvidence: 68,
  },
  {
    name: "cybersecurity",
    jobPatterns: [
      /\bcybersecurity\b/i,
      /\bdigital forensics\b/i,
      /\bforensic\b/i,
      /\bsoc\b/i,
      /\bsiem\b/i,
      /\bthreat\b/i,
      /\bincident response\b/i,
      /\biso 27001\b/i,
      /\bnist\b/i,
      /\bcis controls?\b/i,
      /\bcissp\b/i,
    ],
    minimumEvidence: ["security operations", "digital forensics", "compliance frameworks", "networking"],
    scoreCapWithoutEvidence: 52,
    cautionCapWithoutEvidence: 66,
  },
  {
    name: "media_workflows",
    jobPatterns: [
      /\bpost-production\b/i,
      /\bpost production\b/i,
      /\bmedia workflows?\b/i,
      /\bpremiere\b/i,
      /\bresolve\b/i,
      /\bavid\b/i,
      /\basset management\b/i,
      /\barchiving\b/i,
      /\bcreative workflows?\b/i,
      /\bvfx\b/i,
      /\bm&e\b/i,
      /\bmedia lifecycles?\b/i,
    ],
    minimumEvidence: ["premiere", "asset management", "rtsp"],
    scoreCapWithoutEvidence: 64,
    cautionCapWithoutEvidence: 76,
  },
  {
    name: "solutions_engineering",
    jobPatterns: [
      /\bsolutions engineer(?:ing)?\b/i,
      /\bsales engineer(?:ing)?\b/i,
      /\bpre-sales\b/i,
      /\bpresales\b/i,
      /\bdemonstrations?\b/i,
      /\bproof of concept\b/i,
      /\btechnical discovery\b/i,
      /\brfp\b/i,
    ],
    minimumEvidence: ["sales engineering", "apis"],
    scoreCapWithoutEvidence: 68,
    cautionCapWithoutEvidence: 78,
  },
  {
    name: "solutions_architecture",
    jobPatterns: [
      /\bsolutions architect\b/i,
      /\bsolution architecture\b/i,
      /\bsolution design\b/i,
      /\bstatements of work\b/i,
      /\bscope engagements?\b/i,
      /\bproposal(?:s)?\b/i,
    ],
    minimumEvidence: ["solution architecture", "apis", "sso"],
    scoreCapWithoutEvidence: 70,
    cautionCapWithoutEvidence: 80,
  },
  {
    name: "technical_product",
    jobPatterns: [
      /\btechnical product manager\b/i,
      /\bproduct manager\b/i,
      /\broadmap\b/i,
      /\bprioritization\b/i,
      /\bproduct requirements\b/i,
      /\bstakeholder\b/i,
    ],
    minimumEvidence: ["apis", "sso", "aws"],
    scoreCapWithoutEvidence: 74,
    cautionCapWithoutEvidence: 84,
  },
];

export async function assessJobFit(
  jobDescription: string,
  sourceLabel: string
): Promise<AssessedFitResult> {
  const resumePath = path.join(env.JOB_AGENT_DATA_DIR, "resumes", "master_resume.md");
  const accomplishmentsPath = path.join(env.JOB_AGENT_DATA_DIR, "profiles", "accomplishments.json");
  const strategyPath = path.join(env.JOB_AGENT_DATA_DIR, "profiles", "resume-strategy.json");
  const promptPath = path.join("src", "prompts", "evaluate-fit.txt");

  const [resume, accomplishments, strategyRaw, systemPrompt] = await Promise.all([
    readText(resumePath),
    readText(accomplishmentsPath),
    readText(strategyPath),
    readText(promptPath),
  ]);

  const resumeRecommendation = chooseRecommendedResume(jobDescription, strategyRaw);

  const userContent = [
    "Job Source:",
    sourceLabel,
    "",
    "Resume:",
    resume,
    "",
    "Accomplishments:",
    accomplishments,
    "",
    "Job Description:",
    jobDescription,
  ].join("\n");

  const rawOutputText = await complete("fit", systemPrompt, userContent);
  const parsedAssessment = await parseFitAssessment(rawOutputText);
  const calibration = calibrateFitAssessment(parsedAssessment, jobDescription, [
    resume,
    accomplishments,
  ].join("\n\n"));

  logger.info(
    {
      sourceLabel,
      rawScore: parsedAssessment.score,
      calibratedScore: calibration.calibrated.score,
      rawRecommendation: parsedAssessment.recommendation,
      calibratedRecommendation: calibration.calibrated.recommendation,
      dominantJobFamilies: calibration.dominantJobFamilies,
      missingFamilyEvidence: calibration.missingFamilyEvidence,
      missingHardRequirements: calibration.missingHardRequirements,
      matchedHardRequirements: calibration.matchedHardRequirements,
    },
    "Calibrated fit assessment"
  );

  return {
    rawOutputText,
    fitReport: {
      ...calibration.calibrated,
      ...resumeRecommendation,
    },
  };
}

export function chooseRecommendedResume(
  jobDescription: string,
  strategyRaw: string
): ResumeRecommendation {
  const strategy = JSON.parse(strategyRaw) as ResumeStrategy;
  const haystack = jobDescription.toLowerCase();

  const scoredFamilies = Object.entries(strategy.roleFamilies).map(([familyName, family]) => {
    const matchedKeywords = family.keywords.filter((keyword) =>
      haystack.includes(keyword.toLowerCase())
    );

    return {
      familyName,
      resumePath: family.resumePath,
      matchedKeywords,
      score: matchedKeywords.length,
    };
  });

  scoredFamilies.sort((a, b) => b.score - a.score);

  const best = scoredFamilies[0];

  if (!best || best.score === 0) {
    return {
      recommendedResumePath: strategy.defaultResume,
      recommendedResumeReason:
        "No strong keyword match was found in resume-strategy.json, so the default resume is the safest starting point.",
    };
  }

  return {
    recommendedResumePath: best.resumePath,
    recommendedResumeReason: `Best matched role family: ${best.familyName}. Matching keywords: ${best.matchedKeywords.join(", ")}.`,
  };
}

function tryParseFitAssessment(text: string): ParsedFitAssessment | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as ParsedFitAssessment;
  } catch {
    // Continue to extraction
  }

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]) as ParsedFitAssessment;
  } catch {
    return null;
  }
}

async function normalizeFitAssessmentToJson(rawText: string): Promise<ParsedFitAssessment | null> {
  const systemPrompt = [
    "Convert the provided fit analysis into strict JSON only.",
    "Do not add markdown, explanations, headings, or code fences.",
    'Return exactly one JSON object with these keys:',
    "{",
    '  "score": number,',
    '  "recommendation": "apply_now" | "apply_with_caution" | "skip",',
    '  "strongestMatches": string[],',
    '  "gaps": string[],',
    '  "defensibleAngle": string,',
    '  "talkingPoints": string[]',
    "}",
    "If the source analysis is incomplete, infer the best possible values conservatively from the text.",
    "The score must be an integer from 0 to 100.",
  ].join("\n");

  const userContent = ["Fit analysis to convert:", rawText].join("\n\n");

  try {
    const normalizedText = await complete("fit", systemPrompt, userContent);
    return tryParseFitAssessment(normalizedText);
  } catch (error) {
    logger.warn({ error }, "Normalization pass failed");
    return null;
  }
}

async function parseFitAssessment(text: string): Promise<ParsedFitAssessment> {
  const direct = tryParseFitAssessment(text);
  if (direct) {
    return direct;
  }

  logger.warn(
    { rawOutput: text.slice(0, 1000) },
    "Model did not return valid JSON on first pass — attempting normalization pass"
  );

  const normalized = await normalizeFitAssessmentToJson(text);
  if (normalized) {
    return normalized;
  }

  logger.warn(
    { rawOutput: text.slice(0, 1000) },
    "Model did not return valid JSON after normalization — using fallback assessment"
  );

  return {
    score: 0,
    recommendation: "apply_with_caution",
    strongestMatches: [],
    gaps: ["Could not parse model output — review fit-report.raw.txt and re-run"],
    defensibleAngle: "Manual review required",
    talkingPoints: [],
  };
}

export function calibrateFitAssessment(
  assessment: ParsedFitAssessment,
  jobDescription: string,
  candidateMaterials: string
): CalibrationResult {
  const extractedHardRequirements = extractHardRequirements(jobDescription);
  const requiredHardRequirements = extractedHardRequirements.filter(
    (requirement) => requirement.importance === "required"
  );
  const preferredHardRequirements = extractedHardRequirements.filter(
    (requirement) => requirement.importance === "preferred"
  );
  const candidateEvidenceLabels = extractCandidateEvidenceLabels(candidateMaterials);
  const dominantJobFamilies = detectDominantJobFamilies(jobDescription);
  const roleContext = buildRoleCalibrationContext(jobDescription, dominantJobFamilies);
  const effectiveJobFamilies = roleContext.effectiveFamilies;
  const jobFamilyDefinitions = JOB_FAMILY_DEFINITIONS.filter((family) =>
    effectiveJobFamilies.includes(family.name)
  );

  const matchedHardRequirements = requiredHardRequirements
    .filter((requirement) => candidateEvidenceLabels.has(requirement.label))
    .map((requirement) => requirement.label);

  const missingHardRequirements = requiredHardRequirements
    .filter((requirement) => !candidateEvidenceLabels.has(requirement.label))
    .map((requirement) => requirement.label);

  const missingPreferredHardRequirements = preferredHardRequirements
    .filter((requirement) => !candidateEvidenceLabels.has(requirement.label))
    .map((requirement) => requirement.label);

  const requiredFamilyEvidence = dedupeStrings(
    jobFamilyDefinitions.flatMap((family) => family.minimumEvidence)
  );

  const matchedFamilyEvidence = requiredFamilyEvidence.filter((label) =>
    candidateEvidenceLabels.has(label)
  );
  const missingFamilyEvidence = requiredFamilyEvidence.filter(
    (label) => !candidateEvidenceLabels.has(label)
  );
  const familyOnlyMissingEvidence = missingFamilyEvidence.filter(
    (label) => !missingHardRequirements.includes(label)
  );

  let calibratedScore = assessment.score;
  let recommendation = assessment.recommendation;

  if (jobFamilyDefinitions.length > 0) {
    const dominantCap = Math.min(
      ...jobFamilyDefinitions.map((family) => {
        const missingForFamily = family.minimumEvidence.filter(
          (label) => !candidateEvidenceLabels.has(label)
        ).length;

        if (missingForFamily >= 2) {
          return family.scoreCapWithoutEvidence;
        }

        if (missingForFamily >= 1 && family.cautionCapWithoutEvidence) {
          return family.cautionCapWithoutEvidence;
        }

        return 100;
      })
    );

    calibratedScore = Math.min(calibratedScore, dominantCap);
  }

  const hardRequirementPenalty = missingHardRequirements.reduce(
    (total, label) => total + getRequirementPenalty(label, roleContext, candidateEvidenceLabels),
    0
  );
  const preferredRequirementPenalty = missingPreferredHardRequirements.reduce(
    (total, label) => total + getPreferredRequirementPenalty(label, roleContext, candidateEvidenceLabels),
    0
  );
  const familyPenalty = familyOnlyMissingEvidence.reduce(
    (total, label) => total + getFamilyEvidencePenalty(label, roleContext),
    0
  );

  calibratedScore -= hardRequirementPenalty;
  calibratedScore -= preferredRequirementPenalty;
  calibratedScore -= familyPenalty;

  // Software engineering roles are outside the candidate's background — hard cap and force skip
  if (effectiveJobFamilies.includes("software_engineering" as JobFamilyName)) {
    calibratedScore = Math.min(calibratedScore, 38);
    recommendation = "skip";
  }

  if (
    effectiveJobFamilies.includes("data_analytics") &&
    countMatches(candidateEvidenceLabels, ["sql", "dashboards", "statistics", "a/b testing", "data quality"]) < 2
  ) {
    calibratedScore = Math.min(calibratedScore, 49);
  }

  if (
    roleContext.isCybersecurityPractitionerRole &&
    countMatches(candidateEvidenceLabels, ["security operations", "digital forensics", "compliance frameworks"]) < 1
  ) {
    calibratedScore = Math.min(calibratedScore, 45);
  }

  if (
    effectiveJobFamilies.includes("media_workflows") &&
    countMatches(candidateEvidenceLabels, ["premiere", "resolve", "avid", "asset management", "rtsp"]) < 2
  ) {
    calibratedScore = Math.min(calibratedScore, 69);
  }

  const blockerGaps = missingHardRequirements.filter((label) =>
    isDisqualifyingBlocker(label, roleContext)
  );
  const hasPrimaryFunctionEvidence = hasPrimaryFunctionEvidenceMatch(
    roleContext,
    candidateEvidenceLabels,
    matchedHardRequirements
  );

  if (assessment.score >= 80 && hasPrimaryFunctionEvidence && blockerGaps.length === 0) {
    const safetyFloor = roleContext.roleFunctionFamily === "solutions_engineering" ? 68 : 64;
    calibratedScore = Math.max(calibratedScore, safetyFloor);
  }

  calibratedScore = clamp(calibratedScore, 0, 100);

  if (blockerGaps.length >= 2) {
    recommendation = "skip";
  } else if (blockerGaps.length >= 1 && recommendation === "apply_now") {
    recommendation = "apply_with_caution";
  } else if (recommendation === "apply_now" && calibratedScore < 75) {
    recommendation = "apply_with_caution";
  }

  if (
    effectiveJobFamilies.includes("data_analytics") &&
    calibratedScore < 60
  ) {
    recommendation = "skip";
  }

  if (
    roleContext.isCybersecurityPractitionerRole &&
    calibratedScore < 60
  ) {
    recommendation = "skip";
  }

  if (effectiveJobFamilies.includes("software_engineering" as JobFamilyName)) {
    recommendation = "skip";
  }

  recommendation = applyScoreRecommendationCap(calibratedScore, recommendation);

  const strongestMatches = assessment.strongestMatches.filter((match) =>
    isSupportedByCandidateEvidence(match, candidateEvidenceLabels)
  );

  const gaps = [...assessment.gaps];
  for (const missing of missingFamilyEvidence) {
    const gapText = `Missing direct evidence for ${missing}`;
    if (!gaps.some((existing) => existing.toLowerCase().includes(missing.toLowerCase()))) {
      gaps.unshift(gapText);
    }
  }

  for (const missing of missingHardRequirements) {
    const gapText = `Missing direct evidence for ${missing}`;
    if (!gaps.some((existing) => existing.toLowerCase().includes(missing.toLowerCase()))) {
      gaps.unshift(gapText);
    }
  }

  return {
    calibrated: {
      ...assessment,
      score: calibratedScore,
      recommendation,
      strongestMatches,
      gaps: dedupeStrings(gaps),
      defensibleAngle: buildDefensibleAngle(
        assessment.defensibleAngle,
        effectiveJobFamilies,
        matchedFamilyEvidence,
        missingFamilyEvidence
      ),
      talkingPoints: buildTalkingPoints(assessment.talkingPoints, matchedFamilyEvidence, missingFamilyEvidence),
    },
    missingHardRequirements,
    matchedHardRequirements,
    dominantJobFamilies: effectiveJobFamilies,
    missingFamilyEvidence,
    matchedFamilyEvidence,
  };
}

function extractHardRequirements(jobDescription: string): ExtractedRequirement[] {
  const lines = jobDescription
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let inRequirementSection = false;
  let sectionImportance: RequirementImportance = "required";
  const matches = new Map<string, RequirementImportance>();

  for (const line of lines) {
    const normalized = line.replace(/^[-*]\s*/, "");
    const explicitOptional = OPTIONAL_SECTION_PATTERNS.some((pattern) => pattern.test(normalized));
    const explicitRequired =
      /\b(required|must have|must-haves?|minimum qualifications?)\b/i.test(normalized);

    if (REQUIREMENT_SECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
      inRequirementSection = true;
      sectionImportance = explicitOptional ? "preferred" : "required";
      collectRequirementMatches(normalized, sectionImportance, matches);
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      inRequirementSection = false;
      sectionImportance = "required";
    }

    if (inRequirementSection || /^[*-]\s+/.test(line)) {
      const importance = explicitRequired
        ? "required"
        : explicitOptional
          ? "preferred"
          : sectionImportance;
      collectRequirementMatches(normalized, importance, matches);
      continue;
    }

    if (
      /\b(required|must have|preferred|ideal|experience with|experience in|familiar with|strong understanding of)\b/i.test(
        normalized
      )
    ) {
      collectRequirementMatches(normalized, explicitOptional ? "preferred" : "required", matches);
    }
  }

  return Array.from(matches.entries()).map(([label, importance]) => ({ label, importance }));
}

export function extractRequiredHardRequirements(jobDescription: string): RequirementPattern[] {
  const requiredLabels = extractHardRequirements(jobDescription)
    .filter((requirement) => requirement.importance === "required")
    .map((requirement) => requirement.label);

  return dedupeRequirementPatterns(
    HARD_REQUIREMENT_PATTERNS.filter((requirement) => requiredLabels.includes(requirement.label))
  );
}

function extractCandidateEvidenceLabels(candidateMaterials: string): Set<string> {
  const evidence = candidateMaterials.toLowerCase();
  const labels = new Set<string>();

  for (const requirement of HARD_REQUIREMENT_PATTERNS) {
    if (requirement.patterns.some((pattern) => pattern.test(evidence))) {
      labels.add(requirement.label);
    }
  }

  return labels;
}

function detectJobFamilyScores(jobDescription: string): JobFamilyScore[] {
  const text = jobDescription.toLowerCase();

  return JOB_FAMILY_DEFINITIONS
    .map((family) => ({
      name: family.name,
      score: family.jobPatterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

function detectDominantJobFamilies(jobDescription: string): JobFamilyName[] {
  const scored = detectJobFamilyScores(jobDescription);

  if (scored.length === 0) {
    return [];
  }

  const topScore = scored[0].score;
  return scored
    .filter((entry) => entry.score >= Math.max(1, topScore - 1))
    .map((entry) => entry.name);
}

function collectRequirementMatches(
  text: string,
  importance: RequirementImportance,
  matches: Map<string, RequirementImportance>
): void {
  for (const requirement of HARD_REQUIREMENT_PATTERNS) {
    if (!requirement.patterns.some((pattern) => pattern.test(text))) {
      continue;
    }

    const existing = matches.get(requirement.label);
    if (existing === "required" || importance === existing) {
      continue;
    }

    matches.set(requirement.label, existing === "preferred" ? "required" : importance);
    if (!existing) {
      matches.set(requirement.label, importance);
    }
  }
}

function buildRoleCalibrationContext(
  jobDescription: string,
  dominantJobFamilies: JobFamilyName[]
): RoleCalibrationContext {
  const text = jobDescription.toLowerCase();
  const titleLine = text.split("\n").find((line) => line.trim().startsWith("# ")) ?? "";
  const familyScores = detectJobFamilyScores(jobDescription);
  const scoreByFamily = new Map(familyScores.map((entry) => [entry.name, entry.score]));
  const solutionsScore =
    (scoreByFamily.get("solutions_engineering") ?? 0) +
    (scoreByFamily.get("solutions_architecture") ?? 0);
  const cybersecurityScore = scoreByFamily.get("cybersecurity") ?? 0;
  const practitionerSignals = CYBERSECURITY_PRACTITIONER_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0
  );
  const customerFacingSignals = CUSTOMER_FACING_SOLUTION_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0
  );

  const isCustomerFacingSecurityVendorRole =
    dominantJobFamilies.includes("cybersecurity") && customerFacingSignals >= 3 && solutionsScore >= 2;
  const hasPractitionerTitle = CYBERSECURITY_PRACTITIONER_TITLE_PATTERNS.some((pattern) =>
    pattern.test(titleLine)
  );
  const isCybersecurityPractitionerRole =
    dominantJobFamilies.includes("cybersecurity") &&
    (
      hasPractitionerTitle ||
      (practitionerSignals >= 3 && customerFacingSignals < 3) ||
      (cybersecurityScore > solutionsScore + 1 && customerFacingSignals < 3)
    );

  const effectiveFamilies = dominantJobFamilies.filter((family) => {
    if (family !== "cybersecurity") {
      return true;
    }

    return isCybersecurityPractitionerRole || !isCustomerFacingSecurityVendorRole;
  });

  const roleFunctionFamily =
    effectiveFamilies.find((family) =>
      ["solutions_engineering", "solutions_architecture", "technical_product", "software_engineering", "data_analytics"].includes(
        family
      )
    ) ?? effectiveFamilies[0];

  return {
    effectiveFamilies,
    suppressedFamilies: dominantJobFamilies.filter((family) => !effectiveFamilies.includes(family)),
    roleFunctionFamily,
    isCustomerFacingSecurityVendorRole,
    isCybersecurityPractitionerRole,
  };
}

function getRequirementPenalty(
  label: string,
  context: RoleCalibrationContext,
  candidateEvidenceLabels: Set<string>
): number {
  if (label === "software development") {
    return 28;
  }

  if (label === "python") {
    return context.roleFunctionFamily === "solutions_engineering" ? 4 : 8;
  }

  if (label === "azure" || label === "gcp") {
    return candidateEvidenceLabels.has("aws") ? 4 : 7;
  }

  if (["security operations", "digital forensics", "compliance frameworks"].includes(label)) {
    return context.isCybersecurityPractitionerRole ? 12 : 4;
  }

  return 8;
}

function getPreferredRequirementPenalty(
  label: string,
  context: RoleCalibrationContext,
  candidateEvidenceLabels: Set<string>
): number {
  return Math.max(1, Math.round(getRequirementPenalty(label, context, candidateEvidenceLabels) / 3));
}

function getFamilyEvidencePenalty(label: string, context: RoleCalibrationContext): number {
  if (["security operations", "digital forensics", "compliance frameworks"].includes(label)) {
    return context.isCybersecurityPractitionerRole ? 6 : 0;
  }

  return 4;
}

function isDisqualifyingBlocker(label: string, context: RoleCalibrationContext): boolean {
  if (label === "software development") {
    return true;
  }

  if (["security operations", "digital forensics", "compliance frameworks"].includes(label)) {
    return context.isCybersecurityPractitionerRole;
  }

  return false;
}

function hasPrimaryFunctionEvidenceMatch(
  context: RoleCalibrationContext,
  candidateEvidenceLabels: Set<string>,
  matchedHardRequirements: string[]
): boolean {
  if (context.roleFunctionFamily === "solutions_engineering") {
    return (
      candidateEvidenceLabels.has("sales engineering") ||
      matchedHardRequirements.includes("sales engineering") ||
      candidateEvidenceLabels.has("apis")
    );
  }

  if (context.roleFunctionFamily === "solutions_architecture") {
    return candidateEvidenceLabels.has("solution architecture") || candidateEvidenceLabels.has("sso");
  }

  if (context.roleFunctionFamily === "technical_product") {
    return candidateEvidenceLabels.has("apis") || candidateEvidenceLabels.has("aws");
  }

  return matchedHardRequirements.length > 0;
}

// Labels that sound technical but are NOT in Jesse's background as a developer
const DEVELOPER_FALSE_POSITIVE_LABELS = [
  "software development",
  "javascript",
  "typescript",
  "python",
  "java",
  "golang",
  "rust",
  "c++",
  "c#",
  ".net",
  "full-stack",
  "frontend",
  "backend",
  "code review",
  "pull request",
  "unit test",
];

function isSupportedByCandidateEvidence(match: string, evidenceLabels: Set<string>): boolean {
  const normalized = match.toLowerCase();

  // Reject any match that implies software engineering / development capability
  if (DEVELOPER_FALSE_POSITIVE_LABELS.some((fp) => normalized.includes(fp))) {
    return false;
  }

  if (
    normalized.includes("communication") ||
    normalized.includes("stakeholder") ||
    normalized.includes("problem solving") ||
    normalized.includes("analytical thinking")
  ) {
    return true;
  }

  return Array.from(evidenceLabels).some((label) => normalized.includes(label));
}

function buildDefensibleAngle(
  original: string,
  dominantJobFamilies: JobFamilyName[],
  matchedFamilyEvidence: string[],
  missingFamilyEvidence: string[]
): string {
  if (dominantJobFamilies.length === 0) {
    return original;
  }

  const familyText = dominantJobFamilies.join(", ");
  const matchedText = matchedFamilyEvidence.slice(0, 3).join(", ");

  if (missingFamilyEvidence.length === 0 && matchedText) {
    return `Closest fit is in ${familyText}. The strongest defensible overlap is ${matchedText}.`;
  }

  if (matchedText) {
    return `Closest fit is in ${familyText}, but this is more adjacent than direct. The defensible overlap is ${matchedText}.`;
  }

  return `The role leans toward ${familyText}, but the supplied materials do not show the core evidence strongly enough.`;
}

function buildTalkingPoints(
  originalTalkingPoints: string[],
  matchedFamilyEvidence: string[],
  missingFamilyEvidence: string[]
): string[] {
  const talkingPoints = [...originalTalkingPoints];

  if (matchedFamilyEvidence.length > 0) {
    talkingPoints.unshift(
      `Be explicit about the direct overlap you do have: ${matchedFamilyEvidence.slice(0, 3).join(", ")}.`
    );
  }

  if (missingFamilyEvidence.length > 0) {
    talkingPoints.push(
      `Do not overclaim the missing center-of-gravity areas: ${missingFamilyEvidence.slice(0, 3).join(", ")}.`
    );
  }

  return dedupeStrings(talkingPoints);
}

function dedupeRequirementPatterns(requirements: RequirementPattern[]): RequirementPattern[] {
  const seen = new Set<string>();
  const deduped: RequirementPattern[] = [];

  for (const requirement of requirements) {
    if (seen.has(requirement.label)) {
      continue;
    }

    seen.add(requirement.label);
    deduped.push(requirement);
  }

  return deduped;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(normalized);
  }

  return deduped;
}

function countMatches(evidenceLabels: Set<string>, labels: string[]): number {
  return labels.filter((label) => evidenceLabels.has(label)).length;
}

function applyScoreRecommendationCap(
  score: number,
  recommendation: ParsedFitAssessment["recommendation"]
): ParsedFitAssessment["recommendation"] {
  if (score < 60) {
    return "skip";
  }

  if (score < 80 && recommendation === "apply_now") {
    return "apply_with_caution";
  }

  return recommendation;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
