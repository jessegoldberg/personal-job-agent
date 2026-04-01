import test from "node:test";
import assert from "node:assert/strict";
import { calibrateFitAssessment } from "./fit_assessment.js";

const candidateMaterials = [
  "solutions engineering pre-sales demos technical discovery proof of concept rfp",
  "apis rest sso saml oauth authentication aws linux javascript node.js bash ruby postman playright",
  "customer architecture deployment diagrams integration workflows",
].join("\n");

function assessment(score = 85) {
  return {
    score,
    recommendation: "apply_now" as const,
    strongestMatches: ["sales engineering", "apis", "aws"],
    gaps: [],
    defensibleAngle: "Strong customer-facing technical overlap",
    talkingPoints: [],
  };
}

test("security SaaS solutions engineer remains viable without practitioner security background", () => {
  const jobDescription = `
# Solutions Engineer

Company: Vanta

## Responsibilities
- Lead technical discovery, demos, and proof of concepts for prospects
- Partner with account executives on evaluations and customer architecture discussions
- Guide API integrations, authentication, and deployment planning

## Requirements
- Solutions engineering or sales engineering experience
- Experience with APIs, scripting, and cloud infrastructure
- Familiarity with cybersecurity and compliance concepts
- Python is nice to have
- Knowledge of SIEM and incident response workflows is a plus
`;

  const result = calibrateFitAssessment(assessment(85), jobDescription, candidateMaterials);

  assert.ok(result.dominantJobFamilies.includes("solutions_engineering"));
  assert.notEqual(result.calibrated.recommendation, "skip");
  assert.ok(result.calibrated.score >= 68, `expected viable score, got ${result.calibrated.score}`);
  assert.ok(!result.missingHardRequirements.includes("security operations"));
  assert.ok(!result.missingHardRequirements.includes("compliance frameworks"));
});

test("true security operations role calibrates much lower without practitioner background", () => {
  const jobDescription = `
# Security Operations Analyst

## Responsibilities
- Monitor SIEM alerts and triage incidents
- Support incident response and threat detection workflows
- Perform digital forensics and document findings

## Requirements
- Experience in SOC operations
- SIEM ownership
- Incident response
- Digital forensics
- Knowledge of NIST and CIS controls
`;

  const result = calibrateFitAssessment(assessment(78), jobDescription, candidateMaterials);

  assert.ok(result.dominantJobFamilies.includes("cybersecurity"));
  assert.equal(result.calibrated.recommendation, "skip");
  assert.ok(result.calibrated.score < 50, `expected low score, got ${result.calibrated.score}`);
});

test("cloud security SE with AWS plus auth and APIs gets moderate penalty for missing Azure or GCP", () => {
  const jobDescription = `
# Cloud Security Solutions Engineer

## Responsibilities
- Run demos and technical discovery for enterprise customers
- Support API and SSO integrations
- Discuss reference architectures across AWS, Azure, and GCP

## Requirements
- Solutions engineering experience
- APIs and authentication
- AWS
- Azure
- GCP
`;

  const result = calibrateFitAssessment(assessment(84), jobDescription, candidateMaterials);

  assert.equal(result.calibrated.recommendation, "apply_with_caution");
  assert.ok(result.calibrated.score >= 68, `expected moderate penalty, got ${result.calibrated.score}`);
  assert.ok(result.missingHardRequirements.includes("azure"));
  assert.ok(result.missingHardRequirements.includes("gcp"));
});

test("optional Python does not collapse a strong SE role", () => {
  const jobDescription = `
# Solutions Engineer

## Requirements
- Solutions engineering experience
- APIs
- Authentication and SSO
- Python is nice to have
`;

  const result = calibrateFitAssessment(assessment(82), jobDescription, candidateMaterials);

  assert.notEqual(result.calibrated.recommendation, "skip");
  assert.ok(result.calibrated.score >= 72, `expected small penalty, got ${result.calibrated.score}`);
  assert.ok(!result.missingHardRequirements.includes("python"));
});
