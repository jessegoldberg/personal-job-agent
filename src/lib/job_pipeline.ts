import path from "node:path";
import { readText, writeText } from "./fs.js";
import { env } from "./env.js";
import { assessJobFit } from "./fit_assessment.js";
import { tailorResumeForJob } from "./tailor_resume_workflow.js";
import { draftCoverLetterForJob } from "./cover_letter_workflow.js";
import { renderCoverLetterDocument, renderResumeDocument } from "./document_rendering.js";
import type { FitAssessment } from "../types/fit.js";

type PipelineAction = "apply_now" | "apply_with_caution" | "skip";

export type JobPipelineResult = {
  action: PipelineAction;
  company: string;
  title: string;
  fitReport: FitAssessment;
  outputDir?: string;
  artifacts?: {
    jobPath: string;
    fitReportPath: string;
    fitRawPath: string;
    metadataPath: string;
    resumeMarkdownPath?: string;
    resumePdfPath?: string;
    coverLetterMarkdownPath?: string;
    coverLetterPdfPath?: string;
  };
};

type PipelineOptions = {
  jobDescription: string;
  sourceLabel: string;
  company: string;
  title: string;
  location?: string;
  applyUrl?: string;
  easyApply?: boolean;
  postedText?: string;
};

type ArtifactPaths = {
  dir: string;
  jobPath: string;
  fitReportPath: string;
  fitRawPath: string;
  metadataPath: string;
  resumeBasePath: string;
  coverLetterBasePath: string;
};

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "unknown";
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function shortenRoleTitle(title: string, maxWords = 4): string {
  const words = title.match(/[A-Za-z0-9]+/g) ?? [];
  return words.slice(0, maxWords).join(" ") || "Role";
}

function buildJobMarkdown(options: PipelineOptions): string {
  return [
    `# ${options.title}`,
    "",
    `Company: ${options.company}`,
    `Location: ${options.location || "Unknown"}`,
    `Source: ${options.sourceLabel}`,
    `Job URL: ${options.sourceLabel}`,
    `Apply URL: ${options.applyUrl ?? "Unavailable"}`,
    `Easy Apply: ${options.easyApply ? "Yes" : "No"}`,
    `Posted: ${options.postedText || "Unknown"}`,
    "",
    "## Description",
    "",
    options.jobDescription,
    "",
  ].join("\n");
}

function buildArtifactPaths(action: Exclude<PipelineAction, "skip">, company: string, title: string): ArtifactPaths {
  const companySlug = sanitizePathSegment(company);
  const roleSlug = sanitizePathSegment(title);
  const roleShort = shortenRoleTitle(title);
  const displayCompany = toTitleCase(companySlug.replace(/-/g, " "));
  const displayRole = toTitleCase(sanitizePathSegment(roleShort).replace(/-/g, " "));
  const dir = path.join(env.JOB_AGENT_OUTPUT_DIR, action === "apply_now" ? "apply-now" : "review", companySlug);
  const resumeBaseName = `Jesse Goldberg Resume - ${displayCompany} - ${displayRole}`;
  const coverBaseName = `Jesse Goldberg Cover Letter - ${displayCompany} - ${displayRole}`;

  return {
    dir,
    jobPath: path.join(dir, `${roleSlug}-job.md`),
    fitReportPath: path.join(dir, `${roleSlug}-fit-report.json`),
    fitRawPath: path.join(dir, `${roleSlug}-fit-report.raw.txt`),
    metadataPath: path.join(dir, `${roleSlug}-job-meta.json`),
    resumeBasePath: path.join(dir, resumeBaseName),
    coverLetterBasePath: path.join(dir, coverBaseName),
  };
}

function choosePipelineAction(fitReport: FitAssessment): PipelineAction {
  return fitReport.recommendation;
}

export async function runJobPipeline(options: PipelineOptions): Promise<JobPipelineResult> {
  const jobMarkdown = buildJobMarkdown(options);
  const { fitReport, rawOutputText } = await assessJobFit(jobMarkdown, options.sourceLabel);
  const action = choosePipelineAction(fitReport);

  if (action === "skip") {
    return {
      action,
      company: options.company,
      title: options.title,
      fitReport,
    };
  }

  const paths = buildArtifactPaths(action, options.company, options.title);
  const metadata = {
    company: options.company,
    title: options.title,
    source: options.sourceLabel,
    applyUrl: options.applyUrl,
    easyApply: options.easyApply ?? false,
    location: options.location,
    postedText: options.postedText,
    recommendedResumePath: fitReport.recommendedResumePath,
    recommendedResumeReason: fitReport.recommendedResumeReason,
    action,
    savedAt: new Date().toISOString(),
  };

  await Promise.all([
    writeText(paths.jobPath, jobMarkdown),
    writeText(paths.fitReportPath, JSON.stringify(fitReport, null, 2)),
    writeText(paths.fitRawPath, rawOutputText),
    writeText(paths.metadataPath, JSON.stringify(metadata, null, 2)),
  ]);

  if (action === "apply_with_caution") {
    return {
      action,
      company: options.company,
      title: options.title,
      fitReport,
      outputDir: paths.dir,
      artifacts: {
        jobPath: paths.jobPath,
        fitReportPath: paths.fitReportPath,
        fitRawPath: paths.fitRawPath,
        metadataPath: paths.metadataPath,
      },
    };
  }

  const tailored = await tailorResumeForJob({
    jobDescription: jobMarkdown,
    baselineResumePath: fitReport.recommendedResumePath,
    outputDir: paths.dir,
  });
  const cover = await draftCoverLetterForJob({
    jobDescription: jobMarkdown,
    baselineResumePath: fitReport.recommendedResumePath,
    outputDir: paths.dir,
  });
  const resumeRender = await renderResumeDocument(tailored.outPath, paths.resumeBasePath);
  const coverRender = await renderCoverLetterDocument(cover.outPath, paths.coverLetterBasePath);

  return {
    action,
    company: options.company,
    title: options.title,
    fitReport,
    outputDir: paths.dir,
    artifacts: {
      jobPath: paths.jobPath,
      fitReportPath: paths.fitReportPath,
      fitRawPath: paths.fitRawPath,
      metadataPath: paths.metadataPath,
      resumeMarkdownPath: tailored.outPath,
      resumePdfPath: resumeRender.pdfPath,
      coverLetterMarkdownPath: cover.outPath,
      coverLetterPdfPath: coverRender.pdfPath,
    },
  };
}
