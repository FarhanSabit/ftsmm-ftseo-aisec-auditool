export type LighthouseCategory =
  | 'all'
  | 'performance'
  | 'accessibility'
  | 'best-practices'
  | 'seo'
  | 'security';

export type AuditMode = 'live' | 'demo';
export type AuditRunPhase = 'static' | 'lhr';

export type FlowStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface FresnelLore {
  name: string;
  pronunciation: string;
  origin: string;
  quote: string;
  explanation: string;
}

export interface RepoMetadata {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  isDemo?: boolean;
}

export interface AuditCommit {
  id: string;
  sha: string;
  fullSha: string;
  category: Exclude<LighthouseCategory, 'all'>;
  categoryLabel: string;
  securityContext?: string;
  securityPattern?: string;
  ruleId: string;
  ruleTitle?: string;
  impact?: string;
  lhrAuditTitle?: string;
  lhrDisplayValue?: string;
  lhrTargetSelector?: string;
  lhrAreaImproved?: string;
  title: string;
  commitMessage: string;
  summary: string;
  files: string[];
  additions: number;
  deletions: number;
  author: string;
  date: string;
  body: string;
  diff: string;
}

export interface TelemetryStep {
  index: number;
  phase: string;
  category: string;
  headline: string;
  narrative: string;
  commitId?: string | null;
  sha?: string;
  ruleId?: string;
}

export interface CategoryImprovedItem {
  id: string;
  label: string;
  focus?: string;
  improved: boolean;
  commitsCount: number;
  rules?: string[];
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface GroundingResult {
  model: string;
  query: string;
  summary: string;
  sources: GroundingSource[];
  groundedAt: string;
}

export interface ReportExportBundle {
  markdownFilename: string;
  pdfFilename: string;
  selectedCount: number;
  markdownContent: string;
  markdownDownloadUrl: string;
  pdfDownloadUrl: string;
}

export interface AuditSession {
  id: string;
  interactionId: string;
  mode: AuditMode;
  runPhase: AuditRunPhase;
  categoriesImproved?: CategoryImprovedItem[];
  lhrMeta?: {
    lighthouseVersion: string;
    requestedUrl: string;
    fetchTime: string;
  } | null;
  status: 'in_progress' | 'completed';
  progressPercent: number;
  estimatedRemainingMinutes?: number;
  estimatedRemainingSeconds?: number;
  estimatedTimeRemainingLabel?: string;
  groundingData?: GroundingResult | null;
  repo: RepoMetadata;
  branch: string;
  categories: string[];
  currentStep: TelemetryStep;
  steps: TelemetryStep[];
  totalSteps: number;
  commits: AuditCommit[];
  totalCommits: number;
  pr: PullRequestResult | null;
}

export interface PatchBundle {
  filename: string;
  selectedCount: number;
  patchContent: string;
  downloadUrl: string;
  instructions: {
    cloneCmd: string;
    branchCmd: string;
    applyAmCmd: string;
    applyDiffCmd: string;
    verifyCmd: string;
    pushCmd: string;
  };
}

export interface PullRequestResult {
  number: number;
  mode: AuditMode;
  runPhase?: AuditRunPhase;
  title: string;
  body?: string;
  url: string;
  compareUrl?: string;
  repoUrl: string;
  repoFullName: string;
  baseBranch: string;
  headBranch: string;
  patchFilename?: string;
  patchDownloadUrl?: string;
  terminalCommand?: string;
  shortTerminalCommand?: string;
  createdAt: string;
  selectedCommits: AuditCommit[];
  totalAdditions: number;
  totalDeletions: number;
  filesTouched: string[];
}

export interface RadarMetricAxis {
  id: string;
  label: string;
  shortLabel: string;
  group: 'performance' | 'accessibility' | 'best-practices' | 'seo' | 'security';
  before: number;
  after: number;
  delta: number;
  unit: string;
  description: string;
  contributingCommits: number;
}

export interface AuditImpactMetrics {
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  bestPracticesBefore: number;
  bestPracticesAfter: number;
  seoBefore: number;
  seoAfter: number;
  securityBefore: number;
  securityAfter: number;
  detailedAxes: RadarMetricAxis[];
  categoryAxes: RadarMetricAxis[];
}

export interface SavedAuditHistoryRecord {
  auditId: string;
  ownerId: string;
  repoFullName: string;
  repoUrl: string;
  runPhase: AuditRunPhase;
  mode: AuditMode;
  totalCommitsCount: number;
  selectedCommitsCount: number;
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  bestPracticesBefore: number;
  bestPracticesAfter: number;
  seoBefore: number;
  seoAfter: number;
  securityBefore: number;
  securityAfter: number;
  summaryNotes: string;
  commitTitles: string[];
  createdAtIso: string;
  updatedAtIso: string;
}
