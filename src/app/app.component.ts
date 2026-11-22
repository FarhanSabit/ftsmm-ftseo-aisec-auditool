import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuditService } from './services/audit.service';
import { FirebaseAuthService } from './services/firebase-auth.service';
import { FresnelLogoComponent } from './components/fresnel-logo/fresnel-logo.component';
import { ImpactRadarChartComponent } from './components/impact-radar-chart/impact-radar-chart.component';
import { RepoContextBarComponent } from './components/repo-context-bar/repo-context-bar.component';
import { AuditRunComparisonComponent } from './components/audit-run-comparison/audit-run-comparison.component';
import { LighthouseCategory, SavedAuditHistoryRecord } from './models/audit.model';

export interface CategoryTabItem {
  key: LighthouseCategory;
  label: string;
  contextBadge?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    FormsModule,
    FresnelLogoComponent,
    ImpactRadarChartComponent,
    RepoContextBarComponent,
    AuditRunComparisonComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  readonly audit = inject(AuditService);
  readonly fbAuth = inject(FirebaseAuthService);
  readonly repoUrl = signal<string>('');
  readonly copiedKey = signal<string | null>(null);
  readonly isComparisonPanelOpen = signal<boolean>(true);
  readonly autoCompareNonce = signal<number>(0);
  readonly radarViewMode = signal<'detailed' | 'categories' | 'history' | 'compare'>('detailed');
  readonly isReportHistoryTabActive = computed<boolean>(() => this.radarViewMode() === 'history');
  readonly reportListAnimCycle = signal<number>(1);
  readonly isReportListEntering = signal<boolean>(true);
  private reportListAnimTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Identifies the two most significant saved audit runs in the user's history:
   * - initialAuditId: the earliest / initial scan
   * - latestAuditId: the latest optimized version
   */
  readonly significantAuditPairIds = computed<{
    initialAuditId: string | null;
    latestAuditId: string | null;
  }>(() => {
    const saved = this.fbAuth.savedAudits();
    if (!saved || saved.length === 0) {
      return { initialAuditId: null, latestAuditId: null };
    }
    if (saved.length === 1) {
      return { initialAuditId: null, latestAuditId: saved[0].auditId };
    }

    const sorted = [...saved].sort((a, b) => {
      const cmp = String(a.updatedAtIso || '').localeCompare(String(b.updatedAtIso || ''));
      if (cmp !== 0) return cmp;
      return (
        a.performanceAfter +
        a.accessibilityAfter -
        (b.performanceAfter + b.accessibilityAfter)
      );
    });

    const initial = sorted[0];
    const candidates = sorted.slice(1);
    const latest = candidates.reduce(
      (best, curr) =>
        curr.performanceAfter + curr.accessibilityAfter >=
        best.performanceAfter + best.accessibilityAfter
          ? curr
          : best,
      candidates[candidates.length - 1]
    );

    return {
      initialAuditId: initial.auditId,
      latestAuditId: latest.auditId
    };
  });

  readonly allCategories: CategoryTabItem[] = [
    { key: 'all', label: 'All' },
    { key: 'performance', label: 'Performance' },
    { key: 'accessibility', label: 'Accessibility' },
    { key: 'best-practices', label: 'Best practices' },
    { key: 'seo', label: 'SEO' },
    {
      key: 'security',
      label: 'Web application security findings',
      contextBadge: 'Light'
    }
  ];

  /**
   * Excludes 'security' (Web application security findings) when running the
   * Lighthouse-specific JSON report audit (Run 2), since Lighthouse does not include it.
   */
  readonly visibleCategories = computed<CategoryTabItem[]>(() => {
    const isLhrRun = this.audit.session()?.runPhase === 'lhr';
    if (isLhrRun) {
      return this.allCategories.filter((cat) => cat.key !== 'security');
    }
    return this.allCategories;
  });

  readonly categoriesImprovedList = computed(() => {
    const session = this.audit.session();
    if (!session) return [];
    if (session.categoriesImproved && session.categoriesImproved.length > 0) {
      return session.categoriesImproved;
    }
    const commits = session.commits ?? [];
    const isLhr = session.runPhase === 'lhr';
    const base = [
      { id: 'performance', label: 'Performance' },
      { id: 'accessibility', label: 'Accessibility' },
      { id: 'best-practices', label: 'Best practices' },
      { id: 'seo', label: 'SEO' },
      ...(isLhr ? [] : [{ id: 'security', label: 'Web application security findings (light)' }])
    ];
    return base
      .map((item) => {
        const count = commits.filter((c) => c.category === item.id).length;
        return {
          id: item.id,
          label: item.label,
          improved: count > 0,
          commitsCount: count
        };
      })
      .filter((item) => item.improved);
  });

  readonly currentPrCliCommand = computed<string>(() => {
    const pr = this.audit.prResult();
    if (!pr) return '';
    return this.audit.prCliMode() === 'inline'
      ? pr.terminalCommand ?? ''
      : pr.shortTerminalCommand ?? '';
  });

  onSelectCategoryFilter(category: LighthouseCategory): void {
    this.audit.categoryFilter.set(category);
    if (this.radarViewMode() === 'history') {
      this.radarViewMode.set('detailed');
    }
    this.triggerReportListStagger();
  }

  onSelectReportHistoryTab(): void {
    this.radarViewMode.set('history');
    void this.fbAuth.fetchSavedAuditsFromFirestore();
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const el = document.getElementById('radar-impact-heading');
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    }
  }

  onRadarViewModeChanged(mode: 'detailed' | 'categories' | 'history' | 'compare'): void {
    this.radarViewMode.set(mode);
    if (mode === 'history') {
      void this.fbAuth.fetchSavedAuditsFromFirestore();
    }
  }

  toggleComparisonPanel(): void {
    this.isComparisonPanelOpen.update((v) => !v);
  }

  openComparisonPanel(): void {
    this.isComparisonPanelOpen.set(true);
  }

  isSignificantInitialAudit(record: SavedAuditHistoryRecord): boolean {
    return this.significantAuditPairIds().initialAuditId === record.auditId;
  }

  isSignificantLatestAudit(record: SavedAuditHistoryRecord): boolean {
    return this.significantAuditPairIds().latestAuditId === record.auditId;
  }

  /**
   * Auto-Compare handler invoked from any history list (History Drawer, Saved Audit History Modal,
   * View 4 Saved Audit History sub-view, or History tab). Identifies the two most significant
   * audit runs (initial scan vs. latest optimized version), ensures the report page is open,
   * expands the side-by-side comparison panel, and loads those two runs automatically.
   */
  async onAutoCompareFromHistory(): Promise<void> {
    this.fbAuth.isHistoryDrawerOpen.set(false);
    this.fbAuth.closeHistoryModal();
    this.fbAuth.setView4SubView('pr');

    const saved = this.fbAuth.savedAudits();
    const pair = this.significantAuditPairIds();
    const latestRec =
      saved.find((r) => r.auditId === pair.latestAuditId) ?? saved[0] ?? null;

    const currentStep = this.audit.step();
    const hasSession = !!this.audit.session();

    if (!hasSession) {
      if (latestRec) {
        this.repoUrl.set(latestRec.repoUrl);
        await this.audit.openSavedAuditReport(latestRec);
      } else {
        this.repoUrl.set('https://github.com/fresnel-sandbox/lumina-web-app');
        await this.audit.startAudit('https://github.com/fresnel-sandbox/lumina-web-app', 'demo');
        this.audit.skipToReport();
      }
    } else if (currentStep !== 3 && currentStep !== 7) {
      const targetStep = this.audit.session()?.runPhase === 'lhr' ? 7 : 3;
      this.audit.transitionToStep(targetStep);
    }

    this.isComparisonPanelOpen.set(true);
    this.autoCompareNonce.update((n) => n + 1);

    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const el = document.getElementById('run-compare-section');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }

  triggerReportListStagger(): void {
    if (this.reportListAnimTimer) {
      clearTimeout(this.reportListAnimTimer);
      this.reportListAnimTimer = null;
    }
    this.isReportListEntering.set(false);
    this.reportListAnimCycle.update((n) => n + 1);
    setTimeout(() => {
      this.isReportListEntering.set(true);
      this.reportListAnimTimer = setTimeout(() => {
        this.isReportListEntering.set(false);
      }, 850);
    }, 12);
  }

  async onStartLiveAudit(): Promise<void> {
    const url =
      this.repoUrl().trim() || 'https://github.com/fresnel-sandbox/lumina-web-app';
    await this.audit.startAudit(url, 'live');
  }

  async onStartDemoAudit(): Promise<void> {
    this.repoUrl.set('https://github.com/fresnel-sandbox/lumina-web-app');
    await this.audit.startAudit('https://github.com/fresnel-sandbox/lumina-web-app', 'demo');
  }

  onLhrFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    this.audit.lhrFileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.audit.lhrJsonInput.set(reader.result);
      }
    };
    reader.readAsText(file);
  }

  async onStartLhrAudit(): Promise<void> {
    await this.audit.startLhrAudit();
  }

  async onRunSearchGrounding(): Promise<void> {
    await this.audit.runSearchGrounding();
  }

  async onGithubLoginOrHistoryClick(): Promise<void> {
    await this.fbAuth.handleGithubAuthOrProfileHistory();
  }

  async onSaveAuditToAccount(): Promise<void> {
    const session = this.audit.session();
    if (!session) return;
    await this.fbAuth.saveAuditToAccount(
      session,
      this.audit.impactMetrics(),
      this.audit.selectedCommits()
    );
  }

  async onOpenSavedAudit(record: SavedAuditHistoryRecord): Promise<void> {
    this.fbAuth.isHistoryDrawerOpen.set(false);
    this.fbAuth.closeHistoryModal();
    this.fbAuth.setView4SubView('pr');
    this.repoUrl.set(record.repoUrl);
    await this.audit.openSavedAuditReport(record);
  }

  formatSavedDate(isoString: string): string {
    if (!isoString) return 'Just now';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return 'Recently';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  onBack(): void {
    const current = this.audit.step();
    if (current === 2) {
      this.audit.stopPolling();
      this.audit.transitionToStep(1);
    } else if (current === 3) {
      this.audit.transitionToStep(1);
    } else if (current === 4) {
      this.audit.transitionToStep(this.audit.session()?.runPhase === 'lhr' ? 7 : 3);
    } else if (current === 5) {
      this.audit.transitionToStep(3);
    } else if (current === 6) {
      this.audit.stopPolling();
      this.audit.transitionToStep(5);
    } else if (current === 7) {
      this.audit.transitionToStep(5);
    }
  }

  isSelected(commitId: string): boolean {
    return this.audit.selectedCommitIds().has(commitId);
  }

  isDiffExpanded(commitId: string): boolean {
    return this.audit.expandedDiffIds().has(commitId);
  }

  splitDiffLines(diff: string): { text: string; type: 'meta' | 'hunk' | 'add' | 'del' | 'ctx' }[] {
    return diff.split('\n').map((line) => {
      if (
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ')
      ) {
        return { text: line, type: 'meta' };
      }
      if (line.startsWith('@@')) {
        return { text: line, type: 'hunk' };
      }
      if (line.startsWith('+')) {
        return { text: line, type: 'add' };
      }
      if (line.startsWith('-')) {
        return { text: line, type: 'del' };
      }
      return { text: line, type: 'ctx' };
    });
  }

  toCurlyQuotes(rawText: string | undefined | null): string {
    if (!rawText) return '';
    return rawText
      .replace(/(\w)'(\w)/g, '$1’$2')
      .replace(/(^|[\s(\[{<—–-])"(\S)/g, '$1“$2')
      .replace(/"/g, '”')
      .replace(/(^|[\s(\[{<—–-])'(\S)/g, '$1‘$2')
      .replace(/'/g, '’');
  }

  plainText(rawText: string | undefined | null): string {
    if (!rawText) return '';
    const cleaned = rawText
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/\*\*+/g, '')
      .replace(/__+/g, '')
      .replace(/`+/g, '')
      .replace(/(^|\s)\*+(\S)/g, '$1$2')
      .replace(/(\S)\*+(\s|$|[.,!?;:])/g, '$1$2')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/\b(?:powered\s+by|using|via|on|in)\s+(?:GCP\s+project\s+)?(?:Gemini\s*4\s*Argon(?:\s*EAP)?|gemini-4-argon|gemini-3\.8-flash|antigravity-[a-zA-Z0-9._-]+|phantom-gdemo-1)\b/gi, '')
      .replace(/\bGemini\s*4\s*Argon(?:\s*EAP)?\b/gi, '')
      .replace(/\b(?:gemini-4-argon|gemini-3\.8-flash)\b/gi, '')
      .replace(/\bantigravity-[a-zA-Z0-9._-]+\b/gi, '')
      .replace(/\bphantom-gdemo-1\b/gi, '')
      .replace(/\binteractions\/[a-zA-Z0-9._-]+\b/gi, '')
      .replace(/\/v1beta\/interactions\b/gi, '')
      .replace(/\/workspace\/[a-zA-Z0-9._-]+\//g, '')
      .replace(/\/workspace\b/g, 'the repository')
      .replace(/@import\s+font\s+stylesheets/gi, '@import stylesheets')
      .replace(/\bwith\s+display=swap\b/gi, 'with font-display:swap')
      .replace(/\(\s*\)/g, '')
      .replace(/\s+(?:using|on|via|with)\s*(?=[.,!?;:]|$)/gi, '')
      .replace(/\s+([.,!?;:])/g, '$1')
      .replace(/([a-z0-9%"'’”\]}>])([.!?])(["'‘“(\[{]*[A-Z])/g, '$1$2 $3')
      .replace(/([A-Z]{2,})([.!?])(["'‘“(\[{]*[A-Z])/g, '$1$2 $3')
      .replace(/\s+/g, ' ')
      .trim();
    return this.toCurlyQuotes(cleaned);
  }

  imperativeHeadline(rawText: string | undefined | null): string {
    const cleaned = this.plainText(rawText).replace(/[.!?]+$/, '').trim();
    if (!cleaned) return '';
    const map: Record<string, string> = {
      reading: 'Read',
      reads: 'Read',
      read: 'Read',
      inspecting: 'Inspect',
      inspects: 'Inspect',
      inspected: 'Inspect',
      scanning: 'Scan',
      scans: 'Scan',
      scanned: 'Scan',
      mapping: 'Map',
      maps: 'Map',
      mapped: 'Map',
      preparing: 'Prepare',
      prepares: 'Prepare',
      prepared: 'Prepare',
      parsing: 'Parse',
      parses: 'Parse',
      parsed: 'Parse',
      cloning: 'Clone',
      clones: 'Clone',
      cloned: 'Clone',
      classifying: 'Classify',
      classifies: 'Classify',
      classified: 'Classify',
      clearing: 'Clear',
      clears: 'Clear',
      cleared: 'Clear',
      closing: 'Close',
      closes: 'Close',
      closed: 'Close',
      adding: 'Add',
      adds: 'Add',
      added: 'Add',
      converting: 'Convert',
      converts: 'Convert',
      converted: 'Convert',
      replacing: 'Replace',
      replaces: 'Replace',
      replaced: 'Replace',
      splitting: 'Split',
      splits: 'Split',
      fixing: 'Fix',
      fixes: 'Fix',
      fixed: 'Fix',
      enforcing: 'Enforce',
      enforces: 'Enforce',
      enforced: 'Enforce',
      removing: 'Remove',
      removes: 'Remove',
      removed: 'Remove',
      validating: 'Validate',
      validates: 'Validate',
      validated: 'Validate',
      raising: 'Raise',
      raises: 'Raise',
      raised: 'Raise',
      generating: 'Generate',
      generates: 'Generate',
      generated: 'Generate',
      auditing: 'Audit',
      audits: 'Audit',
      audited: 'Audit',
      analyzing: 'Analyze',
      analyzes: 'Analyze',
      analyzed: 'Analyze',
      checking: 'Check',
      checks: 'Check',
      checked: 'Check',
      updating: 'Update',
      updates: 'Update',
      updated: 'Update',
      optimizing: 'Optimize',
      optimizes: 'Optimize',
      optimized: 'Optimize',
      securing: 'Secure',
      secures: 'Secure',
      secured: 'Secure',
      sanitizing: 'Sanitize',
      sanitizes: 'Sanitize',
      sanitized: 'Sanitize'
    };
    const m = cleaned.match(/^([A-Za-z]+)(\b[\s\S]*)$/);
    if (!m) return cleaned;
    const lower = m[1].toLowerCase();
    if (map[lower]) {
      return `${map[lower]}${m[2]}`;
    }
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  detailTense(
    rawText: string | undefined | null,
    mode: 'active' | 'done' = 'done',
    maxChars = 240
  ): string {
    const shortened = this.cleanSentences(rawText, maxChars);
    if (!shortened) return '';
    const thirdToPast: Record<string, string> = {
      adds: 'added',
      converts: 'converted',
      replaces: 'replaced',
      splits: 'split',
      fixes: 'fixed',
      enforces: 'enforced',
      removes: 'removed',
      validates: 'validated',
      raises: 'raised',
      generates: 'generated',
      creates: 'created',
      updates: 'updated',
      improves: 'improved',
      eliminates: 'eliminated',
      reduces: 'reduced',
      prevents: 'prevented',
      ensures: 'ensured',
      restores: 'restored',
      wires: 'wired',
      injects: 'injected',
      applies: 'applied',
      sets: 'set',
      wraps: 'wrapped',
      moves: 'moved',
      defers: 'deferred',
      preloads: 'preloaded',
      sanitizes: 'sanitized',
      escapes: 'escaped',
      blocks: 'blocked',
      restricts: 'restricted',
      hardens: 'hardened',
      reads: 'read',
      inspects: 'inspected',
      scans: 'scanned',
      maps: 'mapped',
      prepares: 'prepared',
      parses: 'parsed',
      traces: 'traced',
      correlates: 'correlated',
      identifies: 'identified',
      clones: 'cloned',
      classifies: 'classified',
      clears: 'cleared',
      closes: 'closed'
    };
    const baseToPast: Record<string, string> = {
      add: 'Added',
      convert: 'Converted',
      replace: 'Replaced',
      split: 'Split',
      fix: 'Fixed',
      enforce: 'Enforced',
      clone: 'Cloned',
      classify: 'Classified',
      clear: 'Cleared',
      close: 'Closed',
      remove: 'Removed',
      validate: 'Validated',
      raise: 'Raised',
      generate: 'Generated',
      create: 'Created',
      update: 'Updated',
      improve: 'Improved',
      eliminate: 'Eliminated',
      reduce: 'Reduced',
      prevent: 'Prevented',
      ensure: 'Ensured',
      restore: 'Restored',
      wire: 'Wired',
      inject: 'Injected',
      apply: 'Applied',
      set: 'Set',
      wrap: 'Wrapped',
      move: 'Moved',
      defer: 'Deferred',
      preload: 'Preloaded',
      sanitize: 'Sanitized',
      escape: 'Escaped',
      block: 'Blocked',
      restrict: 'Restricted',
      harden: 'Hardened',
      read: 'Read',
      inspect: 'Inspected',
      scan: 'Scanned',
      map: 'Mapped',
      prepare: 'Prepared',
      parse: 'Parsed',
      trace: 'Traced',
      correlate: 'Correlated',
      identify: 'Identified'
    };
    const baseToIng: Record<string, string> = {
      read: 'Reading',
      inspect: 'Inspecting',
      scan: 'Scanning',
      map: 'Mapping',
      prepare: 'Preparing',
      parse: 'Parsing',
      add: 'Adding',
      convert: 'Converting',
      replace: 'Replacing',
      split: 'Splitting',
      fix: 'Fixing',
      enforce: 'Enforcing',
      remove: 'Removing',
      validate: 'Validating',
      raise: 'Raising',
      generate: 'Generating',
      trace: 'Tracing',
      correlate: 'Correlating',
      identify: 'Identifying'
    };

    let result = shortened.replace(
      /\b(and|or|,)\s+([a-z]+s)\b/gi,
      (full, conj, verb) => {
        const mapped = thirdToPast[verb.toLowerCase()];
        return mapped ? `${conj} ${mapped}` : full;
      }
    );

    const m = result.match(/^([A-Za-z]+)(\b[\s\S]*)$/);
    if (!m) return result;
    const firstLower = m[1].toLowerCase();
    const rest = m[2];
    if (thirdToPast[firstLower]) {
      const p = thirdToPast[firstLower];
      return p.charAt(0).toUpperCase() + p.slice(1) + rest;
    }
    if (mode === 'active' && baseToIng[firstLower]) {
      return `${baseToIng[firstLower]}${rest}`;
    }
    if (baseToPast[firstLower]) {
      return `${baseToPast[firstLower]}${rest}`;
    }
    return result;
  }

  cleanSentences(rawText: string | undefined | null, maxChars = 240): string {
    const cleaned = this.plainText(rawText);
    if (!cleaned) return '';
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length === 0) return '';

    let result = '';
    for (const s of sentences) {
      const norm = /[.!?]$/.test(s) ? s : `${s}.`;
      if (!result) {
        result = norm;
      } else if (result.length + 1 + norm.length <= maxChars) {
        result = `${result} ${norm}`;
      } else {
        break;
      }
    }
    return result;
  }

  copyText(key: string, text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      this.copiedKey.set(key);
      setTimeout(() => {
        if (this.copiedKey() === key) {
          this.copiedKey.set(null);
        }
      }, 1500);
    }
  }
}
