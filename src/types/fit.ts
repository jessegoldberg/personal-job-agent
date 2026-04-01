export type FitAssessment = {
  score: number;
  recommendation: "apply_now" | "apply_with_caution" | "skip";
  strongestMatches: string[];
  gaps: string[];
  defensibleAngle: string;
  talkingPoints: string[];
  recommendedResumePath: string;
  recommendedResumeReason: string;
};
