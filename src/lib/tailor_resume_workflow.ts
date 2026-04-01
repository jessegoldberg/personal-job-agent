import path from "node:path";
import { readText, writeText } from "./fs.js";
import { complete } from "./model_client.js";
import { env } from "./env.js";
import { chooseRecommendedResume } from "./fit_assessment.js";
import { validateTailoredResume } from "./resume_validation.js";
import { auditResumeProvenance } from "./resume_provenance.js";

const MAX_TAILOR_PASSES = 3;

function buildTailorPromptInput(params: {
  voice: string;
  baselineResume: string;
  masterResume: string;
  jobDescription: string;
}): string {
  return [
    "Voice profile:",
    params.voice,
    "",
    "Baseline resume:",
    params.baselineResume,
    "",
    "Master resume:",
    params.masterResume,
    "",
    "Job Description:",
    params.jobDescription,
  ].join("\n");
}

function buildRevisionInput(params: {
  voice: string;
  baselineResume: string;
  masterResume: string;
  accomplishments: string;
  jobDescription: string;
  currentDraft: string;
  validationSummary: string;
  validationIssues: string[];
  provenanceIssues: string[];
}): string {
  return [
    "Revise the tailored resume draft below and return the full corrected resume in markdown.",
    "Keep only source-supported claims from the baseline resume, master resume, and accomplishments.",
    "Preserve the candidate's non-developer framing.",
    "",
    "Validation summary:",
    params.validationSummary,
    "",
    "Issues to resolve:",
    ...params.validationIssues.map((issue) => `- ${issue}`),
    ...params.provenanceIssues.map((issue) => `- ${issue}`),
    "",
    "Voice profile:",
    params.voice,
    "",
    "Baseline resume:",
    params.baselineResume,
    "",
    "Master resume:",
    params.masterResume,
    "",
    "Accomplishments:",
    params.accomplishments,
    "",
    "Job Description:",
    params.jobDescription,
    "",
    "Current draft:",
    params.currentDraft,
  ].join("\n");
}

export type TailorResumeWorkflowOptions = {
  jobDescription: string;
  baselineResumePath?: string;
  outputDir?: string;
};

export async function tailorResumeForJob(options: TailorResumeWorkflowOptions): Promise<{
  outPath: string;
  reviewPath: string;
  baselineResumePath: string;
  baselineResumeReason: string;
}> {
  const masterResumePath = path.join(env.JOB_AGENT_DATA_DIR, "resumes", "master_resume.md");
  const voicePath = path.join(env.JOB_AGENT_DATA_DIR, "profiles", "voice_profile.md");
  const accomplishmentsPath = path.join(env.JOB_AGENT_DATA_DIR, "profiles", "accomplishments.json");
  const strategyPath = path.join(env.JOB_AGENT_DATA_DIR, "profiles", "resume-strategy.json");
  const promptPath = path.join("src", "prompts", "tailor-resume.txt");
  const outputDir = options.outputDir ?? env.JOB_AGENT_OUTPUT_DIR;

  const [masterResume, voice, accomplishments, strategyRaw, systemPrompt] = await Promise.all([
    readText(masterResumePath),
    readText(voicePath),
    readText(accomplishmentsPath),
    readText(strategyPath),
    readText(promptPath),
  ]);

  const recommendedResume = chooseRecommendedResume(options.jobDescription, strategyRaw);
  const baselineResumePath = options.baselineResumePath
    ? path.resolve(options.baselineResumePath)
    : path.resolve(recommendedResume.recommendedResumePath);
  const baselineResumeReason = options.baselineResumePath
    ? "Explicit baseline resume argument provided."
    : recommendedResume.recommendedResumeReason;
  const baselineResume = await readText(baselineResumePath);

  let outputText = await complete(
    "tailor",
    systemPrompt,
    buildTailorPromptInput({
      voice,
      baselineResume,
      masterResume,
      jobDescription: options.jobDescription,
    })
  );

  let validation = await validateTailoredResume({
    jobDescription: options.jobDescription,
    baselineResume,
    masterResume,
    accomplishments,
    tailoredResume: outputText,
  });
  let provenance = await auditResumeProvenance({
    baselineResume,
    masterResume,
    accomplishments,
    tailoredResume: outputText,
  });

  for (
    let attempt = 2;
    attempt <= MAX_TAILOR_PASSES && (!validation.approved || !provenance.audit.approved);
    attempt += 1
  ) {
    const validationIssues = [
      ...validation.truthfulnessIssues,
      ...validation.alignmentIssues,
      ...validation.formattingIssues,
    ];
    const provenanceIssues = provenance.audit.claims
      .filter((claim) => !claim.supported)
      .map((claim) => {
        const claimText =
          provenance.claims.find((candidate) => candidate.id === claim.claimId)?.text ?? claim.claimId;
        return `Unsupported claim ${claim.claimId}: ${claimText}. ${claim.notes}`;
      });

    outputText = await complete(
      "tailor",
      systemPrompt,
      buildRevisionInput({
        voice,
        baselineResume,
        masterResume,
        accomplishments,
        jobDescription: options.jobDescription,
        currentDraft: outputText,
        validationSummary: validation.summary,
        validationIssues,
        provenanceIssues,
      })
    );

    validation = await validateTailoredResume({
      jobDescription: options.jobDescription,
      baselineResume,
      masterResume,
      accomplishments,
      tailoredResume: outputText,
    });
    provenance = await auditResumeProvenance({
      baselineResume,
      masterResume,
      accomplishments,
      tailoredResume: outputText,
    });
  }

  const outPath = path.join(outputDir, "tailored-resume.md");
  const blockedOutPath = path.join(outputDir, "tailored-resume.blocked.md");
  const reviewPath = path.join(outputDir, "tailored-resume-review.json");
  const reviewPayload = {
    baselineResumePath,
    baselineResumeReason,
    validation,
    provenance: provenance.audit,
  };

  if (validation.approved && provenance.audit.approved) {
    await Promise.all([
      writeText(outPath, outputText),
      writeText(reviewPath, JSON.stringify(reviewPayload, null, 2)),
    ]);

    return {
      outPath,
      reviewPath,
      baselineResumePath,
      baselineResumeReason,
    };
  }

  await Promise.all([
    writeText(blockedOutPath, outputText),
    writeText(reviewPath, JSON.stringify(reviewPayload, null, 2)),
  ]);

  throw new Error(
    `Tailored resume blocked. Review ${reviewPath} and ${blockedOutPath} for unsupported or weakly grounded claims.`
  );
}
