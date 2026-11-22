import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  linkedSignal,
  signal
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  AuditCommit,
  AuditImpactMetrics,
  AuditMode,
  AuditSession,
  FlowStep,
  FresnelLore,
  GroundingResult,
  LighthouseCategory,
  PatchBundle,
  PullRequestResult,
  RadarMetricAxis,
  ReportExportBundle,
  SavedAuditHistoryRecord
} from '../models/audit.model';

export const DEFAULT_SAMPLE_LHR_JSON = JSON.stringify(
  {
    lighthouseVersion: '12.2.0',
    fetchTime: '2026-10-06T13:35:00.000Z',
    requestedUrl: 'https://lumina-web.app/',
    finalDisplayedUrl: 'https://lumina-web.app/',
    categories: {
      performance: {
        id: 'performance',
        title: 'Performance',
        score: 0.68,
        auditRefs: [
          { id: 'largest-contentful-paint-element', weight: 25, group: 'diagnostics' },
          { id: 'render-blocking-resources', weight: 15, group: 'load-opportunities' },
          { id: 'unsized-images', weight: 10, group: 'diagnostics' }
        ]
      },
      accessibility: {
        id: 'accessibility',
        title: 'Accessibility',
        score: 0.74,
        auditRefs: [
          { id: 'color-contrast', weight: 7, group: 'a11y-color-contrast' },
          { id: 'button-name', weight: 10, group: 'a11y-names-labels' }
        ]
      },
      'best-practices': {
        id: 'best-practices',
        title: 'Best Practices',
        score: 0.83,
        auditRefs: [{ id: 'csp-xss', weight: 5, group: 'trust-safety' }]
      },
      seo: {
        id: 'seo',
        title: 'SEO',
        score: 0.82,
        auditRefs: [{ id: 'structured-data', weight: 5, group: 'seo-content' }]
      }
    },
    audits: {
      'largest-contentful-paint-element': {
        id: 'largest-contentful-paint-element',
        title: 'Largest Contentful Paint element',
        score: 0.28,
        scoreDisplayMode: 'metricSavings',
        numericValue: 3420,
        displayValue: '3,420 ms',
        metricSavings: { LCP: 1180 },
        details: {
          type: 'table',
          items: [
            {
              node: {
                selector: 'section.hero-stage > picture > img.hero-banner-media',
                snippet: '<img class="hero-banner-media" src="/assets/hero-lens.jpg">'
              }
            }
          ]
        }
      },
      'render-blocking-resources': {
        id: 'render-blocking-resources',
        title: 'Eliminate render-blocking resources',
        score: 0.42,
        scoreDisplayMode: 'metricSavings',
        displayValue: 'Potential savings of 640 ms',
        metricSavings: { FCP: 640, LCP: 480 }
      },
      'unsized-images': {
        id: 'unsized-images',
        title: 'Image elements do not have explicit width and height',
        score: 0.0,
        scoreDisplayMode: 'binary',
        displayValue: '3 elements found',
        metricSavings: { CLS: 0.14 }
      },
      'color-contrast': {
        id: 'color-contrast',
        title: 'Background and foreground colors do not have a sufficient contrast ratio',
        score: 0.0,
        scoreDisplayMode: 'binary',
        displayValue: '2 elements fail WCAG AA (3.1:1 vs 4.5:1)'
      }
    }
  },
  null,
  2
);

@Injectable({
  providedIn: 'root'
})
export class AuditService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly clientId: string = this.initClientId();

  private initClientId(): string {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const existing = sessionStorage.getItem('fresnel-client-id');
        if (existing && /^[a-zA-Z0-9_-]{8,128}$/.test(existing)) {
          return existing;
        }
      }
      const generated =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('fresnel-client-id', generated);
      }
      return generated;
    } catch {
      return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    }
  }

  private apiOptions(): { headers: Record<string, string> } {
    return { headers: { 'x-client-id': this.clientId } };
  }

  readonly step = signal<FlowStep>(1);
  readonly isTransitioning = signal<boolean>(false);
  readonly theme = signal<'light' | 'dark'>('light');
  readonly mode = signal<AuditMode>('live');

  readonly lore = signal<FresnelLore>({
    name: 'Fresnel',
    pronunciation: '/freɪˈnɛl/',
    origin:
      'Named after French physicist Augustin-Jean Fresnel (1788–1827), inventor of the stepped concentric lighthouse lens.',
    quote:
      '“Instead of a single heavy dome of glass, concentric stepped prism rings capture scattered light from every angle and refract it into one extraordinary, miles-long beam.”',
    explanation:
      'Just as the Fresnel lens concentrates a lighthouse’s beam to guide ships through fog, Fresnel takes the broad inspection beam of Lighthouse and focuses it onto raw source code—refining scattered issues across performance, accessibility, best practices, SEO, and light web application security findings into sharp, self-contained git commits.'
  });

  readonly session = signal<AuditSession | null>(null);
  readonly selectedCommitIds = signal<Set<string>>(new Set());
  readonly expandedDiffIds = signal<Set<string>>(new Set());

  private readonly sessionScopeKey = computed(
    () => `${this.session()?.id ?? 'init'}:${this.session()?.runPhase ?? 'static'}`
  );

  /** Automatically resets to 'all' whenever a new session or runPhase begins, while remaining writable */
  readonly categoryFilter = linkedSignal<string, LighthouseCategory>({
    source: this.sessionScopeKey,
    computation: () => 'all'
  });

  readonly patchBundle = signal<PatchBundle | null>(null);
  readonly isPatchDrawerOpen = signal<boolean>(false);
  readonly exportBundle = signal<ReportExportBundle | null>(null);
  readonly isExportDrawerOpen = signal<boolean>(false);
  readonly exportPreviewMode = signal<'executive' | 'full'>('executive');
  readonly prResult = signal<PullRequestResult | null>(null);
  readonly isCreatingPr = signal<boolean>(false);

  readonly groundingResult = signal<GroundingResult | null>(null);
  readonly isGroundingLoading = signal<boolean>(false);
  readonly groundingError = signal<string | null>(null);
  readonly groundingQuery = signal<string>('');

  /** Automatically defaults to 'inline' whenever a new PR bundle is generated, while remaining writable */
  readonly prCliMode = linkedSignal<PullRequestResult | null, 'inline' | 'short'>({
    source: this.prResult,
    computation: () => 'inline'
  });

  readonly lhrJsonInput = signal<string>('');
  readonly lhrFileName = signal<string>('');

  readonly allCommits = computed<AuditCommit[]>(() => this.session()?.commits ?? []);

  readonly filteredCommits = computed<AuditCommit[]>(() => {
    const commits = this.allCommits();
    const filter = this.categoryFilter();
    if (filter === 'all') return commits;
    return commits.filter((c) => c.category === filter);
  });

  readonly selectedCount = computed<number>(() => this.selectedCommitIds().size);
  readonly totalCommitsCount = computed<number>(() => this.allCommits().length);

  readonly selectedCommits = computed<AuditCommit[]>(() => {
    const selected = this.selectedCommitIds();
    return this.allCommits().filter((c) => selected.has(c.id));
  });

  /**
   * Consolidates and ranks the Top 3 most critical Performance and Accessibility
   * fixes identified in the audit for the single-page Executive Summary PDF document.
   */
  readonly topThreeExecutiveFixes = computed<
    {
      rank: number;
      priorityBadge: string;
      categoryBadge: string;
      metricTarget: string;
      businessOutcome: string;
      commit: AuditCommit;
    }[]
  >(() => {
    const all = this.allCommits();
    const sel = this.selectedCommits();
    const basePool = sel.length > 0 ? sel : all;

    // Filter to performance and accessibility fixes first
    let perfAndA11y = basePool.filter(
      (c) => c.category === 'performance' || c.category === 'accessibility'
    );
    if (perfAndA11y.length < 3) {
      const fallbackPerfA11y = all.filter(
        (c) =>
          (c.category === 'performance' || c.category === 'accessibility') &&
          !perfAndA11y.some((existing) => existing.id === c.id)
      );
      perfAndA11y = [...perfAndA11y, ...fallbackPerfA11y];
    }
    if (perfAndA11y.length < 3) {
      const remaining = all.filter((c) => !perfAndA11y.some((existing) => existing.id === c.id));
      perfAndA11y = [...perfAndA11y, ...remaining];
    }

    const scoreCriticality = (c: AuditCommit): number => {
      const hay = `${c.ruleId} ${c.title} ${c.summary} ${c.impact}`.toLowerCase();
      let score = 0;
      if (c.category === 'performance') score += 50;
      if (c.category === 'accessibility') score += 48;
      if (hay.includes('lcp') || hay.includes('largest contentful') || hay.includes('preload') || hay.includes('fetchpriority')) {
        score += 35;
      }
      if (hay.includes('cls') || hay.includes('layout shift') || hay.includes('dimension') || hay.includes('aspect-ratio')) {
        score += 30;
      }
      if (hay.includes('contrast') || hay.includes('wcag') || hay.includes('aria') || hay.includes('screen reader')) {
        score += 32;
      }
      if (hay.includes('render-blocking') || hay.includes('defer') || hay.includes('fid') || hay.includes('inp')) {
        score += 24;
      }
      score += Math.min(15, (c.additions || 0) + (c.deletions || 0));
      return score;
    };

    const sorted = [...perfAndA11y].sort((a, b) => scoreCriticality(b) - scoreCriticality(a));

    // Ensure both Performance and Accessibility are represented in the top 3 when available
    const topPerf = sorted.filter((c) => c.category === 'performance');
    const topA11y = sorted.filter((c) => c.category === 'accessibility');
    const chosen: AuditCommit[] = [];

    if (topPerf.length > 0) chosen.push(topPerf[0]);
    if (topA11y.length > 0) chosen.push(topA11y[0]);
    for (const candidate of sorted) {
      if (chosen.length >= 3) break;
      if (!chosen.some((c) => c.id === candidate.id)) {
        chosen.push(candidate);
      }
    }

    return chosen.slice(0, 3).map((commit, idx) => {
      const rank = idx + 1;
      const hay = `${commit.ruleId} ${commit.title} ${commit.summary}`.toLowerCase();
      const isPerf = commit.category === 'performance';

      let metricTarget = isPerf
        ? 'Core Web Vitals · LCP & Main-Thread Render'
        : 'WCAG 2.2 AA · Assistive Technology & Contrast';
      let businessOutcome = isPerf
        ? 'Accelerates above-the-fold visual completion and reduces bounce rate on initial page load.'
        : 'Eliminates WCAG 2.2 Level AA compliance barriers for screen-reader and keyboard users.';

      if (hay.includes('lcp') || hay.includes('preload') || hay.includes('fetchpriority') || hay.includes('hero')) {
        metricTarget = 'Core Web Vitals · Largest Contentful Paint (LCP)';
        businessOutcome =
          'Cuts hero paint latency by prioritizing critical media discovery, directly lifting Core Web Vitals pass rates.';
      } else if (hay.includes('cls') || hay.includes('dimension') || hay.includes('unsized') || hay.includes('shift')) {
        metricTarget = 'Core Web Vitals · Cumulative Layout Shift (CLS)';
        businessOutcome =
          'Locks intrinsic media aspect ratios prior to decode, preventing jarring visual reflows and misclicks.';
      } else if (hay.includes('contrast')) {
        metricTarget = 'WCAG 2.2 Level AA · Color Contrast (1.4.3)';
        businessOutcome =
          'Restores ≥ 4.5:1 foreground-to-background luminance contrast for low-vision readability and regulatory compliance.';
      } else if (hay.includes('aria') || hay.includes('button') || hay.includes('label') || hay.includes('focus')) {
        metricTarget = 'WCAG 2.2 Level A/AA · ARIA Name, Role & Focus (4.1.2)';
        businessOutcome =
          'Exposes deterministic accessible names and keyboard focus rings across interactive controls.';
      }

      return {
        rank,
        priorityBadge: `CRITICAL FIX #0${rank}`,
        categoryBadge: isPerf ? 'PERFORMANCE' : commit.category === 'accessibility' ? 'ACCESSIBILITY' : commit.categoryLabel.toUpperCase(),
        metricTarget,
        businessOutcome,
        commit
      };
    });
  });

  /**
   * Computes dynamic Before-vs-After impact metrics for the D3 radar chart
   * based on which generated commits are currently selected by the user.
   */
  readonly impactMetrics = computed<AuditImpactMetrics>(() => {
    const all = this.allCommits();
    const selectedSet = this.selectedCommitIds();
    const selected = all.filter((c) => selectedSet.has(c.id));
    const isLhr = this.session()?.runPhase === 'lhr';

    const countByCat = (cat: Exclude<LighthouseCategory, 'all'>) => {
      const totalInCat = all.filter((c) => c.category === cat).length;
      const selInCat = selected.filter((c) => c.category === cat).length;
      const ratio = totalInCat > 0 ? selInCat / totalInCat : 0;
      return { totalInCat, selInCat, ratio };
    };

    const perf = countByCat('performance');
    const a11y = countByCat('accessibility');
    const bp = countByCat('best-practices');
    const seo = countByCat('seo');
    const sec = countByCat('security');

    const performanceBefore = isLhr ? 64 : 61;
    const performanceAfter = Math.round(performanceBefore + perf.ratio * (96 - performanceBefore));

    const accessibilityBefore = isLhr ? 72 : 69;
    const accessibilityAfter = Math.round(
      accessibilityBefore + a11y.ratio * (98 - accessibilityBefore)
    );

    const bestPracticesBefore = isLhr ? 79 : 76;
    const bestPracticesAfter = Math.round(
      bestPracticesBefore + bp.ratio * (96 - bestPracticesBefore)
    );

    const seoBefore = isLhr ? 81 : 78;
    const seoAfter = Math.round(seoBefore + seo.ratio * (98 - seoBefore));

    const securityBefore = 70;
    const securityAfter = isLhr
      ? 92
      : Math.round(securityBefore + sec.ratio * (95 - securityBefore));

    // Granular Performance & Accessibility sub-axes for the 6-axis deep-dive radar
    const perfCommits = all.filter((c) => c.category === 'performance');
    const selPerfCommits = selected.filter((c) => c.category === 'performance');

    const a11yCommits = all.filter((c) => c.category === 'accessibility');
    const selA11yCommits = selected.filter((c) => c.category === 'accessibility');

    const matchRatio = (
      pool: AuditCommit[],
      selPool: AuditCommit[],
      pattern: RegExp,
      fallbackRatio: number
    ): { ratio: number; count: number } => {
      const matchingAll = pool.filter((c) =>
        pattern.test(`${c.ruleId} ${c.title} ${c.summary} ${c.lhrAreaImproved ?? ''}`)
      );
      if (matchingAll.length === 0) {
        return { ratio: fallbackRatio, count: selPool.length };
      }
      const matchingSel = selPool.filter((c) =>
        pattern.test(`${c.ruleId} ${c.title} ${c.summary} ${c.lhrAreaImproved ?? ''}`)
      );
      return {
        ratio: matchingSel.length / matchingAll.length,
        count: matchingSel.length
      };
    };

    const lcpMatch = matchRatio(
      perfCommits,
      selPerfCommits,
      /lcp|largest-contentful|fetchpriority|preload|hero|image|webp|avif/i,
      perf.ratio
    );
    const clsMatch = matchRatio(
      perfCommits,
      selPerfCommits,
      /cls|layout-shift|unsized|width|height|aspect-ratio|font-display|swap/i,
      perf.ratio
    );
    const tbtMatch = matchRatio(
      perfCommits,
      selPerfCommits,
      /render-blocking|tbt|defer|async|bundle|script|css|preload|critical/i,
      perf.ratio
    );

    const contrastMatch = matchRatio(
      a11yCommits,
      selA11yCommits,
      /contrast|wcag|color|token|foreground|background/i,
      a11y.ratio
    );
    const ariaMatch = matchRatio(
      a11yCommits,
      selA11yCommits,
      /aria|button-name|label|input|role|screen-reader|alt/i,
      a11y.ratio
    );
    const focusMatch = matchRatio(
      a11yCommits,
      selA11yCommits,
      /focus|keyboard|landmark|heading|main|nav|skip|tabindex/i,
      a11y.ratio
    );

    const makeAxis = (
      id: string,
      label: string,
      shortLabel: string,
      group: RadarMetricAxis['group'],
      before: number,
      targetMax: number,
      ratio: number,
      contributingCommits: number,
      description: string
    ): RadarMetricAxis => {
      const after = Math.round(before + ratio * (targetMax - before));
      return {
        id,
        label,
        shortLabel,
        group,
        before,
        after,
        delta: Math.max(0, after - before),
        unit: 'pts',
        description,
        contributingCommits
      };
    };

    const detailedAxes: RadarMetricAxis[] = [
      makeAxis(
        'lcp',
        'LCP (Largest Contentful Paint)',
        'LCP',
        'performance',
        56,
        96,
        lcpMatch.ratio,
        lcpMatch.count,
        'Largest Contentful Paint priority hints, responsive image decoding, and critical resource preloads.'
      ),
      makeAxis(
        'cls',
        'CLS (Cumulative Layout Shift)',
        'CLS',
        'performance',
        63,
        98,
        clsMatch.ratio,
        clsMatch.count,
        'Cumulative Layout Shift prevention via explicit intrinsic dimensions and font-display: swap.'
      ),
      makeAxis(
        'fid',
        'FID / INP (First Input Delay)',
        'FID',
        'performance',
        62,
        95,
        tbtMatch.ratio,
        tbtMatch.count,
        'First Input Delay and main-thread responsiveness improvements by eliminating render-blocking assets.'
      ),
      makeAxis(
        'performance-score',
        'Performance Score',
        'Performance',
        'performance',
        performanceBefore,
        96,
        perf.ratio,
        perf.selInCat,
        'Overall Lighthouse Performance score impact across selected atomic code commits.'
      ),
      makeAxis(
        'accessibility-score',
        'Accessibility Score',
        'Accessibility',
        'accessibility',
        accessibilityBefore,
        98,
        a11y.ratio,
        a11y.selInCat,
        'Overall Lighthouse Accessibility score impact across WCAG 2.2 AA contrast, ARIA labels, and landmarks.'
      ),
      makeAxis(
        'wcag-aria',
        'WCAG Contrast & ARIA Semantics',
        'WCAG & ARIA',
        'accessibility',
        66,
        98,
        (contrastMatch.ratio + ariaMatch.ratio + focusMatch.ratio) / 3,
        contrastMatch.count + ariaMatch.count,
        'Foreground-to-background 4.5:1 contrast compliance, accessible names, and semantic landmarks.'
      )
    ];

    const categoryAxes: RadarMetricAxis[] = [
      makeAxis(
        'cat-performance',
        'Performance',
        'Performance',
        'performance',
        performanceBefore,
        96,
        perf.ratio,
        perf.selInCat,
        'Core Web Vitals (LCP, CLS, TBT) and asset delivery optimizations.'
      ),
      makeAxis(
        'cat-accessibility',
        'Accessibility',
        'Accessibility',
        'accessibility',
        accessibilityBefore,
        98,
        a11y.ratio,
        a11y.selInCat,
        'WCAG 2.2 AA compliance, ARIA labeling, contrast, and keyboard navigation.'
      ),
      makeAxis(
        'cat-best-practices',
        'Best Practices',
        'Best Practices',
        'best-practices',
        bestPracticesBefore,
        96,
        bp.ratio,
        bp.selInCat,
        'Modern browser APIs, CSP hardening, and runtime reliability patterns.'
      ),
      makeAxis(
        'cat-seo',
        'SEO',
        'SEO',
        'seo',
        seoBefore,
        98,
        seo.ratio,
        seo.selInCat,
        'Canonical metadata, crawlable document structure, and structured data.'
      ),
      ...(isLhr
        ? []
        : [
            makeAxis(
              'cat-security',
              'Web Security (Light)',
              'Web Security',
              'security',
              securityBefore,
              95,
              sec.ratio,
              sec.selInCat,
              'Static remediation of DOM XSS sinks, token storage leaks, and open redirects.'
            )
          ])
    ];

    return {
      performanceBefore,
      performanceAfter,
      accessibilityBefore,
      accessibilityAfter,
      bestPracticesBefore,
      bestPracticesAfter,
      seoBefore,
      seoAfter,
      securityBefore,
      securityAfter,
      detailedAxes,
      categoryAxes
    };
  });

  /**
   * Computes the estimated remaining minutes during the analysis phase (Step 2 & Step 6).
   */
  readonly estimatedRemainingMinutes = computed<number>(() => {
    const s = this.session();
    if (!s) return 3;
    if (typeof s.estimatedRemainingMinutes === 'number' && s.estimatedRemainingMinutes > 0) {
      return s.estimatedRemainingMinutes;
    }
    const progress = s.progressPercent ?? 12;
    if (progress < 35) return 3;
    if (progress < 72) return 2;
    return 1;
  });

  /**
   * Formats the audit time estimation label as 'Approximately X minutes remaining' during the analysis phase.
   */
  readonly estimatedTimeRemainingLabel = computed<string>(() => {
    const s = this.session();
    if (
      s?.estimatedTimeRemainingLabel &&
      s.status !== 'completed' &&
      s.estimatedTimeRemainingLabel.includes('Approximately')
    ) {
      return s.estimatedTimeRemainingLabel;
    }
    const mins = this.estimatedRemainingMinutes();
    return `Approximately ${mins} minutes remaining`;
  });

  readonly categoryCounts = computed<Record<LighthouseCategory, number>>(() => {
    const commits = this.allCommits();
    return {
      all: commits.length,
      performance: commits.filter((c) => c.category === 'performance').length,
      accessibility: commits.filter((c) => c.category === 'accessibility').length,
      'best-practices': commits.filter((c) => c.category === 'best-practices').length,
      seo: commits.filter((c) => c.category === 'seo').length,
      security: commits.filter((c) => c.category === 'security').length
    };
  });

  constructor() {
    const savedTheme =
      typeof localStorage !== 'undefined'
        ? (localStorage.getItem('fresnel-theme') as 'light' | 'dark' | null)
        : null;
    if (savedTheme === 'dark' || savedTheme === 'light') {
      this.theme.set(savedTheme);
    }

    effect(() => {
      const activeTheme = this.theme();
      this.document?.documentElement?.setAttribute('data-theme', activeTheme);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('fresnel-theme', activeTheme);
      }
    });

    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  setTheme(nextTheme: 'light' | 'dark'): void {
    this.theme.set(nextTheme);
  }

  toggleTheme(): void {
    this.theme.update((current) => (current === 'light' ? 'dark' : 'light'));
  }

  transitionToStep(nextStep: FlowStep): void {
    if (this.step() === nextStep) return;
    this.isTransitioning.set(true);
    setTimeout(() => {
      this.step.set(nextStep);
      this.isTransitioning.set(false);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 240);
  }

  async startAudit(repoUrl: string, mode: AuditMode = 'live'): Promise<void> {
    this.stopPolling();
    this.mode.set(mode);
    this.isPatchDrawerOpen.set(false);
    this.isExportDrawerOpen.set(false);
    this.groundingResult.set(null);
    this.groundingError.set(null);

    const response = await firstValueFrom(
      this.http.post<AuditSession>(
        '/api/audit/start',
        {
          repoUrl: mode === 'demo' ? 'https://github.com/fresnel-sandbox/lumina-web-app' : repoUrl,
          mode,
          branch: 'main',
          categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security']
        },
        this.apiOptions()
      )
    );

    this.session.set(response);
    this.transitionToStep(2);

    this.pollTimer = setInterval(() => {
      void this.pollStatus();
    }, 680);
  }

  openLighthouseJsonStep(): void {
    this.isPatchDrawerOpen.set(false);
    this.isExportDrawerOpen.set(false);
    if (!this.lhrJsonInput()) {
      this.loadSampleLhrJson();
    }
    this.transitionToStep(5);
  }

  loadSampleLhrJson(): void {
    this.lhrJsonInput.set(DEFAULT_SAMPLE_LHR_JSON);
    this.lhrFileName.set('lighthouse-report-lhr.json (sample LHR)');
  }

  async startLhrAudit(): Promise<void> {
    this.stopPolling();
    this.isPatchDrawerOpen.set(false);
    this.isExportDrawerOpen.set(false);
    this.groundingResult.set(null);
    this.groundingError.set(null);
    const currentId = this.session()?.id || 'demo';

    const response = await firstValueFrom(
      this.http.post<AuditSession>(
        `/api/audit/${currentId}/lhr-start`,
        {
          lhrJson: this.lhrJsonInput() || DEFAULT_SAMPLE_LHR_JSON
        },
        this.apiOptions()
      )
    );

    this.session.set(response);
    this.transitionToStep(6);

    this.pollTimer = setInterval(() => {
      void this.pollStatus();
    }, 680);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollStatus(): Promise<void> {
    const current = this.session();
    if (!current) return;

    try {
      const updated = await firstValueFrom(
        this.http.get<AuditSession>(`/api/audit/${current.id}/status`, this.apiOptions())
      );
      this.session.set(updated);

      if (updated.status === 'completed') {
        this.stopPolling();
        setTimeout(() => {
          if (this.step() === 2) {
            this.prepareReportState(updated);
            this.transitionToStep(3);
          } else if (this.step() === 6) {
            this.prepareReportState(updated);
            this.transitionToStep(7);
          }
        }, 650);
      }
    } catch (err) {
      this.stopPolling();
      console.error(
        'Status poll error:',
        err instanceof Error
          ? err
          : new Error(
              err instanceof Object && 'message' in err
                ? String((err as { message: unknown }).message)
                : String(err)
            )
      );
    }
  }

  async skipToReport(): Promise<void> {
    const current = this.session();
    if (!current || (current.mode !== 'demo' && this.mode() !== 'demo')) return;
    this.stopPolling();

    const updated = await firstValueFrom(
      this.http.post<AuditSession>(`/api/audit/${current.id}/fast-forward`, {}, this.apiOptions())
    );
    this.session.set(updated);
    this.prepareReportState(updated);
    this.transitionToStep(updated.runPhase === 'lhr' ? 7 : 3);
  }

  /**
   * Restores a saved audit report from Firestore and transitions directly
   * to the interactive Report page (Step 3 or Step 7).
   */
  async openSavedAuditReport(record: SavedAuditHistoryRecord): Promise<void> {
    this.stopPolling();
    this.mode.set(record.mode || 'live');
    this.isPatchDrawerOpen.set(false);
    this.isExportDrawerOpen.set(false);
    this.groundingResult.set(null);
    this.groundingError.set(null);

    try {
      const started = await firstValueFrom(
        this.http.post<AuditSession>(
          '/api/audit/start',
          {
            repoUrl: record.repoUrl || `https://github.com/${record.repoFullName}`,
            mode: record.mode || 'live',
            branch: record.branch || 'main',
            categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security']
          },
          this.apiOptions()
        )
      );

      let completed: AuditSession;
      if (record.runPhase === 'lhr') {
        const lhrStarted = await firstValueFrom(
          this.http.post<AuditSession>(
            `/api/audit/${started.id}/lhr-start`,
            {
              lhrJson: this.lhrJsonInput() || DEFAULT_SAMPLE_LHR_JSON
            },
            this.apiOptions()
          )
        );
        completed = await firstValueFrom(
          this.http.post<AuditSession>(
            `/api/audit/${lhrStarted.id}/fast-forward`,
            {},
            this.apiOptions()
          )
        );
      } else {
        completed = await firstValueFrom(
          this.http.post<AuditSession>(
            `/api/audit/${started.id}/fast-forward`,
            {},
            this.apiOptions()
          )
        );
      }

      this.session.set(completed);
      this.prepareReportState(completed);

      // If the saved record specifies which commit titles were selected, restore that selection
      if (record.commitTitles && record.commitTitles.length > 0 && completed.commits.length > 0) {
        const titleSet = new Set(record.commitTitles.map((t) => t.trim().toLowerCase()));
        const matchedIds = completed.commits
          .filter((c) => titleSet.has(c.title.trim().toLowerCase()))
          .map((c) => c.id);
        if (matchedIds.length > 0) {
          this.selectedCommitIds.set(new Set(matchedIds));
          void this.refreshPatchBundle();
          void this.refreshExportBundle();
        }
      }

      this.transitionToStep(completed.runPhase === 'lhr' ? 7 : 3);
    } catch {
      await this.startAudit(
        record.repoUrl || `https://github.com/${record.repoFullName}`,
        record.mode || 'live'
      );
    }
  }

  private prepareReportState(sessionData: AuditSession): void {
    const allIds = new Set(sessionData.commits.map((c) => c.id));
    this.selectedCommitIds.set(allIds);
    const firstId = sessionData.commits[0]?.id;
    this.expandedDiffIds.set(firstId ? new Set([firstId]) : new Set());
    this.categoryFilter.set('all');
    if (sessionData.groundingData) {
      this.groundingResult.set(sessionData.groundingData);
    }
    void this.refreshPatchBundle();
    void this.refreshExportBundle();
  }

  toggleCommitSelection(commitId: string): void {
    const next = new Set(this.selectedCommitIds());
    if (next.has(commitId)) {
      next.delete(commitId);
    } else {
      next.add(commitId);
    }
    this.selectedCommitIds.set(next);
    void this.refreshPatchBundle();
    void this.refreshExportBundle();
  }

  selectAllCommits(): void {
    this.selectedCommitIds.set(new Set(this.allCommits().map((c) => c.id)));
    void this.refreshPatchBundle();
    void this.refreshExportBundle();
  }

  clearAllCommits(): void {
    this.selectedCommitIds.set(new Set());
    void this.refreshPatchBundle();
    void this.refreshExportBundle();
  }

  toggleDiff(commitId: string): void {
    const next = new Set(this.expandedDiffIds());
    if (next.has(commitId)) {
      next.delete(commitId);
    } else {
      next.add(commitId);
    }
    this.expandedDiffIds.set(next);
  }

  buildClientSidePatchFallback(): { filename: string; content: string } {
    const current = this.session();
    const selectedSet = this.selectedCommitIds();
    const chosen = (current?.commits ?? []).filter((c) => selectedSet.has(c.id));
    const suffix = current?.runPhase === 'lhr' ? 'lhr-fixes' : 'code-audit';
    const filename = `fresnel-${current?.repo?.repo || 'repository'}-${suffix}.patch`;
    const total = chosen.length;
    if (total === 0) {
      return { filename, content: '# No commits selected\n' };
    }
    const content = chosen
      .map((c, idx) =>
        [
          `From ${c.fullSha || c.sha} Mon Sep 17 00:00:00 2001`,
          `From: ${c.author || 'Fresnel <fresnel@noreplies.github.com>'}`,
          `Date: ${c.date || new Date().toUTCString()}`,
          `Subject: [PATCH ${idx + 1}/${total}] ${c.commitMessage || c.title}`,
          ``,
          c.summary,
          `---`,
          c.diff,
          `-- `,
          `2.47.0`,
          ``
        ].join('\n')
      )
      .join('\n');
    return { filename, content };
  }

  buildClientSideMarkdownFallback(): { filename: string; content: string } {
    const current = this.session();
    const repoFullName = current?.repo?.fullName || 'fresnel-sandbox/lumina-web-app';
    const repoUrl = current?.repo?.url || `https://github.com/${repoFullName}`;
    const branch = current?.branch || 'main';
    const isLhr = current?.runPhase === 'lhr';
    const suffix = isLhr ? 'lhr-audit-report' : 'audit-report';
    const filename = `fresnel-${current?.repo?.repo || 'repository'}-${suffix}.md`;

    const allCommits = current?.commits ?? [];
    const selectedSet = this.selectedCommitIds();
    const chosen =
      allCommits.filter((c) => selectedSet.has(c.id)).length > 0
        ? allCommits.filter((c) => selectedSet.has(c.id))
        : allCommits;

    const totalAdditions = chosen.reduce((acc, c) => acc + (c.additions || 0), 0);
    const totalDeletions = chosen.reduce((acc, c) => acc + (c.deletions || 0), 0);
    const filesTouched = Array.from(new Set(chosen.flatMap((c) => c.files || [])));
    const generatedAt = new Date().toISOString();

    const lines: string[] = [
      `# ${
        isLhr
          ? `Fresnel Lighthouse JSON (LHR) Code Audit Report — ${repoFullName}`
          : `Fresnel Static Code & Light Security Audit Report — ${repoFullName}`
      }`,
      '',
      `> Generated by **Fresnel** — Focused static code audit across Performance, Accessibility, Best Practices, SEO${
        isLhr ? '' : ', and Light Web Application Security Findings'
      }.`,
      '',
      `## 1. Executive Summary & Audit Metadata`,
      '',
      `| Property | Value |`,
      `| :--- | :--- |`,
      `| **Repository** | [${repoFullName}](${repoUrl}) |`,
      `| **Target Branch** | \`${branch}\` |`,
      `| **Audit Phase** | ${
        isLhr
          ? 'Run 2 · Lighthouse Result (LHR) JSON Targeted Audit'
          : 'Run 1 · Static Code & Light Web Security Audit'
      } |`,
      `| **Generated At** | \`${generatedAt}\` |`,
      `| **Commits Included** | **${chosen.length}** of ${allCommits.length} atomic commits |`,
      `| **Lines Changed** | \`+${totalAdditions}\` additions / \`-${totalDeletions}\` deletions across **${filesTouched.length}** file(s) |`,
      ''
    ];

    const grounding = this.groundingResult() || current?.groundingData;
    if (grounding && grounding.summary) {
      lines.push(
        `## 2. Google Search Grounded Web Standards & Documentation References`,
        '',
        grounding.summary.trim(),
        ''
      );
      if (grounding.sources && grounding.sources.length > 0) {
        lines.push(`### Verified Web Citations`);
        for (const src of grounding.sources) {
          lines.push(`- [${src.title || src.uri}](${src.uri})`);
        }
        lines.push('');
      }
    }

    const sectionIdx = grounding && grounding.summary ? 3 : 2;
    lines.push(`## ${sectionIdx}. Atomic Git Commits & Unified Diffs`, '');

    chosen.forEach((commit, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      lines.push(
        `### ${num}. ${commit.title}`,
        '',
        `- **Commit SHA**: \`${commit.sha}\` (\`${commit.fullSha || commit.sha}\`)`,
        `- **Category**: **${commit.categoryLabel}**${
          commit.securityContext ? ` (${commit.securityContext})` : ''
        }`,
        `- **Rule / Audit ID**: \`${commit.ruleId || commit.category}\`${
          commit.impact ? ` · **Impact**: ${commit.impact}` : ''
        }`,
        `- **Files Modified**: ${(commit.files || []).map((f) => `\`${f}\``).join(', ')}`,
        '',
        `**Summary**: ${commit.summary}`,
        '',
        '```diff',
        (commit.diff || '').trim(),
        '```',
        ''
      );
    });

    return { filename, content: lines.join('\n') };
  }

  buildClientSidePdfBytes(): { filename: string; bytes: Uint8Array } {
    const current = this.session();
    const repoFullName = current?.repo?.fullName || 'fresnel-sandbox/lumina-web-app';
    const isLhr = current?.runPhase === 'lhr';
    const suffix = isLhr ? 'lhr-audit-report' : 'audit-report';
    const filename = `fresnel-${current?.repo?.repo || 'repository'}-${suffix}.pdf`;

    const allCommits = current?.commits ?? [];
    const selectedSet = this.selectedCommitIds();
    const chosen =
      allCommits.filter((c) => selectedSet.has(c.id)).length > 0
        ? allCommits.filter((c) => selectedSet.has(c.id))
        : allCommits;

    const esc = (s: string) =>
      String(s ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[—–•·]/g, '-')
        .replace(/[^\x20-\x7E]/g, '');

    const items: { text: string; font: 'F1' | 'F2' | 'F3'; size: number; leading: number; indent: number }[] = [];
    const push = (
      text: string,
      font: 'F1' | 'F2' | 'F3' = 'F1',
      size = 10,
      leading = 14,
      indent = 50
    ) => {
      items.push({ text: esc(text), font, size, leading, indent });
    };

    push('FRESNEL CODE AUDIT DOCUMENTATION REPORT', 'F2', 16, 22, 50);
    push(
      isLhr
        ? `Run 2: Lighthouse Result (LHR) JSON Targeted Audit - ${repoFullName}`
        : `Run 1: Static Code & Light Security Audit - ${repoFullName}`,
      'F2',
      11,
      18,
      50
    );
    push(`Generated: ${new Date().toUTCString()} | Included Commits: ${chosen.length}`, 'F1', 9.5, 18, 50);

    const grounding = this.groundingResult() || current?.groundingData;
    if (grounding && grounding.summary) {
      push('GOOGLE SEARCH GROUNDED WEB STANDARDS INSIGHTS', 'F2', 12, 18, 50);
      for (const line of grounding.summary.split('\n')) {
        const t = line.trim();
        if (t) push(t.slice(0, 88), 'F1', 9, 13, 58);
      }
      push('', 'F1', 8, 10, 50);
    }

    push('ATOMIC GIT COMMITS & CODE DIFFS', 'F2', 12, 18, 50);
    chosen.forEach((c, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      push(`${num}. ${c.title}`, 'F2', 10.5, 15, 50);
      push(
        `SHA: ${c.sha} | Category: ${c.categoryLabel} | Rule: ${c.ruleId} | Files: ${c.files.join(', ')}`,
        'F3',
        8.5,
        13,
        58
      );
      push(c.summary.slice(0, 92), 'F1', 9, 13, 58);
      for (const dLine of c.diff.split('\n').slice(0, 12)) {
        push(dLine.slice(0, 90), 'F3', 8, 11, 64);
      }
      push('', 'F1', 8, 10, 50);
    });

    const pages: string[] = [];
    let currentStream: string[] = [];
    let y = 740;
    for (const item of items) {
      if (y - item.leading < 54) {
        pages.push(currentStream.join('\n'));
        currentStream = [];
        y = 740;
      }
      if (item.text) {
        currentStream.push(
          `BT /${item.font} ${item.size} Tf 1 0 0 1 ${item.indent} ${y} Tm (${item.text}) Tj ET`
        );
      }
      y -= item.leading;
    }
    if (currentStream.length > 0 || pages.length === 0) {
      pages.push(currentStream.join('\n'));
    }

    const objects: string[] = ['', ''];
    const addObj = (body: string) => {
      objects.push(body);
      return objects.length;
    };
    const f1Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const f2Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const f3Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

    const pageIds: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      const stream = `${pages[i]}\nBT /F1 8 Tf 1 0 0 1 50 30 Tm (Fresnel Audit Report - Page ${i + 1} of ${pages.length}) Tj ET`;
      const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const pageId = addObj(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1Id} 0 R /F2 ${f2Id} 0 R /F3 ${f3Id} 0 R >> >> /Contents ${contentId} 0 R >>`
      );
      pageIds.push(pageId);
    }
    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    const encoder = new TextEncoder();
    return { filename, bytes: encoder.encode(pdf) };
  }

  /**
   * Builds a clean, single-page business-ready Executive Summary Markdown brief
   * consolidating the Top 3 most critical Performance and Accessibility fixes.
   */
  buildExecutiveSummaryMarkdown(): { filename: string; content: string } {
    const current = this.session();
    const repoFullName = current?.repo?.fullName || 'fresnel-sandbox/lumina-web-app';
    const branch = current?.branch || 'main';
    const isLhr = current?.runPhase === 'lhr';
    const filename = `fresnel-${current?.repo?.repo || 'repository'}-executive-summary.md`;

    const metrics = this.impactMetrics();
    const topFixes = this.topThreeExecutiveFixes();
    const lcpAxis = metrics.detailedAxes.find((a) => a.id === 'lcp');
    const clsAxis = metrics.detailedAxes.find((a) => a.id === 'cls');
    const fidAxis = metrics.detailedAxes.find((a) => a.id === 'fid');

    const lines: string[] = [
      `# EXECUTIVE SUMMARY — PERFORMANCE & ACCESSIBILITY AUDIT`,
      `## Repository: \`${repoFullName}\` (branch: \`${branch}\`)`,
      '',
      `> **Single-Page Business Brief** · Consolidated top 3 most critical Performance & Accessibility remediations ready for 1-click pull request deployment.`,
      '',
      `### Projected Core Web Vitals & Compliance Lift`,
      `| Executive KPI | Baseline (Before) | Projected (After) | Net Business Lift |`,
      `| :--- | :---: | :---: | :---: |`,
      `| **Performance Score** | ${metrics.performanceBefore} / 100 | **${metrics.performanceAfter} / 100** | **+${metrics.performanceAfter - metrics.performanceBefore} pts** |`,
      `| **Accessibility Score (WCAG 2.2 AA)** | ${metrics.accessibilityBefore} / 100 | **${metrics.accessibilityAfter} / 100** | **+${metrics.accessibilityAfter - metrics.accessibilityBefore} pts** |`,
      `| **LCP (Largest Contentful Paint)** | ${lcpAxis?.before ?? 56} / 100 (3.8s) | **${lcpAxis?.after ?? 95} / 100 (1.3s)** | **+${(lcpAxis?.after ?? 95) - (lcpAxis?.before ?? 56)} pts (-2.5s)** |`,
      `| **CLS (Cumulative Layout Shift)** | ${clsAxis?.before ?? 63} / 100 (0.21) | **${clsAxis?.after ?? 97} / 100 (0.015)** | **+${(clsAxis?.after ?? 97) - (clsAxis?.before ?? 63)} pts** |`,
      `| **FID / INP Responsiveness** | ${fidAxis?.before ?? 62} / 100 | **${fidAxis?.after ?? 94} / 100** | **+${(fidAxis?.after ?? 94) - (fidAxis?.before ?? 62)} pts** |`,
      '',
      `### Top 3 Most Critical Performance & Accessibility Fixes`,
      ''
    ];

    topFixes.forEach((item) => {
      const c = item.commit;
      lines.push(
        `#### 0${item.rank}. [${item.categoryBadge}] ${c.title}`,
        `- **Priority & Target Metric**: \`${item.priorityBadge}\` · ${item.metricTarget} (\`${c.ruleId}\`)`,
        `- **Business & UX Impact**: ${item.businessOutcome}`,
        `- **Engineering Remediation**: ${c.summary}`,
        `- **Target Files & Patch Stats**: ${(c.files || []).map((f) => `\`${f}\``).join(', ')} (\`+${c.additions} / -${c.deletions}\` · commit \`${c.sha}\`)`,
        ''
      );
    });

    lines.push(
      `---`,
      `**Deployment Readiness**: ${
        isLhr ? 'Run 2 Lighthouse JSON Verified' : 'Run 1 Static Code Audit Verified'
      } · All 3 critical fixes are packaged as atomic git commits ready via \`git am\` or 1-Click Pull Request.`
    );

    return { filename, content: lines.join('\n') };
  }

  /**
   * Generates a strictly single-page (Page 1 of 1, US Letter 612x792 pt) business-ready
   * Executive Summary PDF document consolidating the Top 3 most critical Performance and
   * Accessibility fixes with vector header banner, Core Web Vitals KPI cards, and executive sign-off.
   */
  buildExecutiveSummaryPdfBytes(): { filename: string; bytes: Uint8Array } {
    const current = this.session();
    const repoFullName = current?.repo?.fullName || 'fresnel-sandbox/lumina-web-app';
    const branch = current?.branch || 'main';
    const isLhr = current?.runPhase === 'lhr';
    const filename = `fresnel-${current?.repo?.repo || 'repository'}-executive-summary.pdf`;

    const metrics = this.impactMetrics();
    const topFixes = this.topThreeExecutiveFixes();
    const lcpAxis = metrics.detailedAxes.find((a) => a.id === 'lcp');
    const clsAxis = metrics.detailedAxes.find((a) => a.id === 'cls');
    const wcagAxis = metrics.detailedAxes.find((a) => a.id === 'wcag-aria');

    const lcpBefore = lcpAxis?.before ?? 56;
    const lcpAfter = lcpAxis?.after ?? 95;
    const clsBefore = clsAxis?.before ?? 63;
    const clsAfter = clsAxis?.after ?? 97;
    const wcagBefore = wcagAxis?.before ?? 66;
    const wcagAfter = wcagAxis?.after ?? 96;

    const esc = (s: string) =>
      String(s ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[—–•·→]/g, '-')
        .replace(/[^\x20-\x7E]/g, '');

    const wrapText = (raw: string, maxChars: number, maxLines: number): string[] => {
      const cleaned = String(raw ?? '').replace(/\s+/g, ' ').trim();
      if (!cleaned) return [];
      const words = cleaned.split(' ');
      const lines: string[] = [];
      let currentLine = '';

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (candidate.length <= maxChars) {
          currentLine = candidate;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word.slice(0, maxChars);
          if (lines.length >= maxLines) break;
        }
      }
      if (currentLine && lines.length < maxLines) {
        lines.push(currentLine);
      }
      return lines.slice(0, maxLines);
    };

    const cmds: string[] = [];
    const textAt = (
      x: number,
      y: number,
      txt: string,
      font: 'F1' | 'F2' | 'F3' = 'F1',
      size = 9.5,
      r = 0.08,
      g = 0.11,
      b = 0.18
    ) => {
      cmds.push(
        `q ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${esc(txt)}) Tj ET Q`
      );
    };

    const rectFill = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
      g: number,
      b: number
    ) => {
      cmds.push(
        `q ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f Q`
      );
    };

    const rectStroke = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
      g: number,
      b: number,
      lineWidth = 0.8
    ) => {
      cmds.push(
        `q ${lineWidth.toFixed(2)} w ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S Q`
      );
    };

    // 1. EXECUTIVE HEADER BANNER (Top of Single-Page Document: y=696..760)
    rectFill(36, 694, 540, 66, 0.06, 0.09, 0.16);
    rectFill(36, 756, 540, 4, 0.05, 0.65, 0.91); // Cyan/blue executive top accent bar

    textAt(50, 738, 'FRESNEL EXECUTIVE SUMMARY  |  SINGLE-PAGE BUSINESS BRIEF', 'F2', 8.5, 0.22, 0.74, 0.97);
    textAt(
      50,
      721,
      `Top 3 Critical Performance & Accessibility Fixes: ${repoFullName}`,
      'F2',
      13.5,
      1,
      1,
      1
    );
    const dateShort = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    textAt(
      50,
      705,
      `Branch: ${branch}   |   Phase: ${
        isLhr ? 'Run 2 Lighthouse JSON (LHR) Audit' : 'Run 1 Static Code & CWV Audit'
      }   |   Date: ${dateShort}   |   Format: 1-Page Executive Brief`,
      'F1',
      8.2,
      0.78,
      0.84,
      0.92
    );

    // 2. PROJECTED BUSINESS & CORE WEB VITALS IMPACT KPI STRIP (y=604..680)
    textAt(
      36,
      676,
      '1. EXECUTIVE IMPACT SNAPSHOT (BEFORE VS. AFTER REMEDIATION)',
      'F2',
      9.5,
      0.08,
      0.11,
      0.18
    );

    const kpiCards = [
      {
        label: 'OVERALL PERFORMANCE',
        before: `${metrics.performanceBefore}`,
        after: `${metrics.performanceAfter}/100`,
        gain: `+${metrics.performanceAfter - metrics.performanceBefore} pts`,
        sub: 'Lighthouse Performance',
        accent: [0.05, 0.52, 0.9] as [number, number, number]
      },
      {
        label: 'ACCESSIBILITY (WCAG 2.2)',
        before: `${metrics.accessibilityBefore}`,
        after: `${metrics.accessibilityAfter}/100`,
        gain: `+${metrics.accessibilityAfter - metrics.accessibilityBefore} pts`,
        sub: `AA Contrast & ARIA (${wcagBefore}->${wcagAfter})`,
        accent: [0.06, 0.65, 0.45] as [number, number, number]
      },
      {
        label: 'LCP (HERO PAINT SPEED)',
        before: '3.8s',
        after: '1.3s',
        gain: `+${lcpAfter - lcpBefore} pts`,
        sub: `Score ${lcpBefore} -> ${lcpAfter} (<=2.5s Good)`,
        accent: [0.02, 0.52, 0.78] as [number, number, number]
      },
      {
        label: 'CLS (LAYOUT STABILITY)',
        before: '0.210',
        after: '0.015',
        gain: `+${clsAfter - clsBefore} pts`,
        sub: `Score ${clsBefore} -> ${clsAfter} (<=0.10 Good)`,
        accent: [0.06, 0.62, 0.43] as [number, number, number]
      }
    ];

    const cardW = 129;
    const cardGap = 8;
    kpiCards.forEach((kpi, idx) => {
      const cx = 36 + idx * (cardW + cardGap);
      const cy = 606;
      const ch = 61;
      rectFill(cx, cy, cardW, ch, 0.965, 0.975, 0.99);
      rectStroke(cx, cy, cardW, ch, 0.84, 0.87, 0.92, 0.8);
      rectFill(cx, cy + ch - 3, cardW, 3, kpi.accent[0], kpi.accent[1], kpi.accent[2]);

      textAt(cx + 8, cy + 46, kpi.label, 'F2', 7.1, 0.35, 0.41, 0.5);
      textAt(
        cx + 8,
        cy + 27,
        `${kpi.before} -> ${kpi.after}`,
        'F2',
        11.2,
        0.06,
        0.09,
        0.16
      );
      textAt(
        cx + 8,
        cy + 15,
        `Net Lift: ${kpi.gain}`,
        'F2',
        7.8,
        kpi.accent[0],
        kpi.accent[1],
        kpi.accent[2]
      );
      textAt(cx + 8, cy + 5, kpi.sub, 'F1', 6.8, 0.42, 0.47, 0.56);
    });

    // 3. TOP 3 MOST CRITICAL PERFORMANCE & ACCESSIBILITY FIXES (y=124..584)
    textAt(
      36,
      586,
      '2. TOP 3 MOST CRITICAL PERFORMANCE & ACCESSIBILITY FIXES (PRIORITIZED ROADMAP)',
      'F2',
      9.5,
      0.08,
      0.11,
      0.18
    );

    const cardHeight = 142;
    const cardSpacing = 12;
    topFixes.forEach((item, idx) => {
      const c = item.commit;
      const topY = 576 - idx * (cardHeight + cardSpacing);
      const bottomY = topY - cardHeight;
      const isPerf = c.category === 'performance';
      const accentRGB: [number, number, number] = isPerf
        ? [0.05, 0.52, 0.9]
        : [0.06, 0.63, 0.44];

      // Card container & left priority stripe
      rectFill(36, bottomY, 540, cardHeight, 0.985, 0.99, 0.998);
      rectStroke(36, bottomY, 540, cardHeight, 0.82, 0.86, 0.91, 0.9);
      rectFill(36, bottomY, 5, cardHeight, accentRGB[0], accentRGB[1], accentRGB[2]);

      // Top badge strip inside card
      rectFill(49, topY - 22, 132, 15, accentRGB[0], accentRGB[1], accentRGB[2]);
      textAt(
        54,
        topY - 17.5,
        `${item.priorityBadge} - ${item.categoryBadge}`,
        'F2',
        7.2,
        1,
        1,
        1
      );

      textAt(
        188,
        topY - 17.5,
        `Target: ${item.metricTarget}  |  Rule: ${c.ruleId}  |  Commit: ${c.sha}`,
        'F3',
        7.4,
        0.28,
        0.34,
        0.44
      );

      // Fix Headline
      textAt(
        49,
        topY - 36,
        `0${item.rank}. ${c.title.slice(0, 78)}`,
        'F2',
        10.6,
        0.06,
        0.09,
        0.16
      );

      // Business & User Experience Outcome
      textAt(49, topY - 51, 'Business & UX Impact:', 'F2', 8.0, accentRGB[0], accentRGB[1], accentRGB[2]);
      const bizLines = wrapText(item.businessOutcome, 76, 1);
      textAt(140, topY - 51, bizLines[0] || item.businessOutcome, 'F1', 8.0, 0.14, 0.18, 0.26);

      // Technical Summary (2 wrapped lines)
      textAt(49, topY - 66, 'Technical Remediation:', 'F2', 8.0, 0.15, 0.2, 0.28);
      const summaryLines = wrapText(c.summary, 94, 2);
      if (summaryLines[0]) {
        textAt(49, topY - 78, summaryLines[0], 'F1', 7.9, 0.2, 0.25, 0.34);
      }
      if (summaryLines[1]) {
        textAt(49, topY - 89, summaryLines[1], 'F1', 7.9, 0.2, 0.25, 0.34);
      }

      // Code Diff Preview / Files Bar at bottom of card
      rectFill(49, bottomY + 8, 514, 34, 0.94, 0.955, 0.975);
      const filesList = (c.files || []).join(', ').slice(0, 62);
      textAt(
        56,
        bottomY + 30,
        `Files Modified: ${filesList}   (+${c.additions} additions / -${c.deletions} deletions)`,
        'F3',
        7.3,
        0.12,
        0.16,
        0.24
      );

      // Extract a key +addition / -deletion line from the unified diff
      const diffPreviewLine =
        (c.diff || '')
          .split('\n')
          .find(
            (ln) =>
              (ln.startsWith('+') && !ln.startsWith('+++')) ||
              (ln.startsWith('-') && !ln.startsWith('---'))
          ) || '+ Verified atomic remediation commit ready for git am';
      textAt(
        56,
        bottomY + 16,
        `Key Patch Diff: ${diffPreviewLine.slice(0, 82)}`,
        'F3',
        7.2,
        0.05,
        0.44,
        0.32
      );
    });

    // 4. EXECUTIVE ACTION PLAN & SINGLE-PAGE SIGN-OFF FOOTER (y=36..108)
    const totalAdd = topFixes.reduce((acc, f) => acc + (f.commit.additions || 0), 0);
    const totalDel = topFixes.reduce((acc, f) => acc + (f.commit.deletions || 0), 0);
    const totalFiles = Array.from(
      new Set(topFixes.flatMap((f) => f.commit.files || []))
    ).length;

    rectFill(36, 56, 540, 52, 0.95, 0.968, 0.99);
    rectStroke(36, 56, 540, 52, 0.05, 0.52, 0.9, 0.9);

    textAt(
      48,
      94,
      '3. DEPLOYMENT READINESS & ENGINEERING HANDOFF',
      'F2',
      8.5,
      0.05,
      0.45,
      0.8
    );
    textAt(
      48,
      80,
      `Scope: Top 3 Critical Fixes (${totalFiles} files, +${totalAdd} / -${totalDel} lines)   |   Delivery: Self-contained git patch & 1-Click GitHub PR`,
      'F1',
      8.1,
      0.12,
      0.16,
      0.24
    );
    textAt(
      48,
      66,
      `CLI Apply Command:  git checkout -b fresnel/critical-fixes && git am --3way fresnel-${
        current?.repo?.repo || 'repository'
      }.patch`,
      'F3',
      7.5,
      0.18,
      0.23,
      0.32
    );

    // Strictly Single-Page Footer
    textAt(
      36,
      36,
      `Fresnel Executive Summary  |  ${repoFullName}  |  Business-Ready Single-Page Audit Brief  |  Page 1 of 1`,
      'F1',
      7.8,
      0.42,
      0.47,
      0.56
    );

    const stream = cmds.join('\n');
    const objects: string[] = ['', ''];
    const addObj = (body: string) => {
      objects.push(body);
      return objects.length;
    };

    const f1Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const f2Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const f3Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

    const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1Id} 0 R /F2 ${f2Id} 0 R /F3 ${f3Id} 0 R >> >> /Contents ${contentId} 0 R >>`
    );

    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[1] = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`;

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    const encoder = new TextEncoder();
    return { filename, bytes: encoder.encode(pdf) };
  }

  /**
   * Triggers immediate download of the single-page Executive Summary PDF
   * consolidating the Top 3 most critical Performance and Accessibility fixes,
   * and opens the Executive Summary preview card.
   */
  exportExecutiveSummaryPdf(): void {
    this.exportPreviewMode.set('executive');
    this.isExportDrawerOpen.set(true);
    const execPdf = this.buildExecutiveSummaryPdfBytes();
    const blob = new Blob([execPdf.bytes], { type: 'application/pdf' });
    this.triggerBlobDownload(execPdf.filename, blob);
  }

  async refreshPatchBundle(): Promise<PatchBundle | null> {
    const current = this.session();
    if (!current) return null;

    const bundle = await firstValueFrom(
      this.http.post<PatchBundle>(
        `/api/audit/${current.id}/patch`,
        {
          selectedCommitIds: Array.from(this.selectedCommitIds())
        },
        this.apiOptions()
      )
    );
    this.patchBundle.set(bundle);
    return bundle;
  }

  async refreshExportBundle(): Promise<ReportExportBundle | null> {
    const current = this.session();
    if (!current) return null;

    try {
      const bundle = await firstValueFrom(
        this.http.post<ReportExportBundle>(
          `/api/audit/${current.id}/export`,
          {
            selectedCommitIds: Array.from(this.selectedCommitIds())
          },
          this.apiOptions()
        )
      );
      this.exportBundle.set(bundle);
      return bundle;
    } catch {
      return null;
    }
  }

  openPatchGuideAndDownload(): void {
    this.isPatchDrawerOpen.set(true);
    const cached = this.patchBundle();
    if (cached && cached.patchContent) {
      this.triggerBrowserDownload(cached.filename, cached.patchContent, cached.downloadUrl);
    } else {
      const fallback = this.buildClientSidePatchFallback();
      this.triggerBrowserDownload(fallback.filename, fallback.content);
    }
    void this.refreshPatchBundle();
  }

  toggleExportDrawer(): void {
    this.isExportDrawerOpen.update((v) => !v);
    if (this.isExportDrawerOpen()) {
      void this.refreshExportBundle();
    }
  }

  exportReportAsMarkdown(): void {
    this.isExportDrawerOpen.set(true);
    const cached = this.exportBundle();
    if (cached && cached.markdownContent) {
      this.triggerBrowserDownload(
        cached.markdownFilename,
        cached.markdownContent,
        cached.markdownDownloadUrl,
        'text/markdown;charset=utf-8'
      );
    } else {
      const fallback = this.buildClientSideMarkdownFallback();
      this.triggerBrowserDownload(
        fallback.filename,
        fallback.content,
        undefined,
        'text/markdown;charset=utf-8'
      );
    }
    void this.refreshExportBundle();
  }

  async exportReportAsPdf(): Promise<void> {
    this.isExportDrawerOpen.set(true);
    const current = this.session();
    const cached = this.exportBundle();

    if (current && cached?.pdfDownloadUrl) {
      try {
        const pdfBlob = await firstValueFrom(
          this.http.get(cached.pdfDownloadUrl, {
            headers: { 'x-client-id': this.clientId },
            responseType: 'blob'
          })
        );
        this.triggerBlobDownload(cached.pdfFilename, pdfBlob);
        return;
      } catch {
        // Fall through to client-side PDF generator
      }
    }

    const fallbackPdf = this.buildClientSidePdfBytes();
    const blob = new Blob([fallbackPdf.bytes], { type: 'application/pdf' });
    this.triggerBlobDownload(fallbackPdf.filename, blob);
  }

  async runSearchGrounding(customQuery?: string): Promise<void> {
    const current = this.session();
    if (!current || this.isGroundingLoading()) return;

    this.isGroundingLoading.set(true);
    this.groundingError.set(null);

    try {
      const queryToSend = (customQuery ?? this.groundingQuery()).trim();
      const result = await firstValueFrom(
        this.http.post<GroundingResult>(
          `/api/audit/${current.id}/grounding`,
          { query: queryToSend },
          this.apiOptions()
        )
      );
      this.groundingResult.set(result);
      void this.refreshExportBundle();
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'error' in err && err.error && typeof err.error === 'object' && 'error' in err.error
          ? String((err.error as { error: unknown }).error)
          : err instanceof Error
            ? err.message
            : 'Unable to fetch Google Search grounding right now.';
      this.groundingError.set(msg);
    } finally {
      this.isGroundingLoading.set(false);
    }
  }

  triggerBlobDownload(filename: string, blob: Blob): void {
    if (!this.document?.body) return;
    const url = URL.createObjectURL(blob);
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    this.document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 250);
  }

  triggerBrowserDownload(
    filename: string,
    content: string,
    downloadUrl?: string,
    mimeType = 'text/x-diff;charset=utf-8'
  ): void {
    if (!this.document?.body) return;
    try {
      const blob = new Blob([content], { type: mimeType });
      this.triggerBlobDownload(filename, blob);
    } catch {
      if (downloadUrl && typeof window !== 'undefined') {
        const anchor = this.document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = filename;
        anchor.click();
      }
    }
  }

  async createPullRequest(): Promise<void> {
    const current = this.session();
    if (!current || this.selectedCommitIds().size === 0) return;

    this.isCreatingPr.set(true);
    try {
      const pr = await firstValueFrom(
        this.http.post<PullRequestResult>(
          `/api/audit/${current.id}/pr`,
          {
            selectedCommitIds: Array.from(this.selectedCommitIds())
          },
          this.apiOptions()
        )
      );
      this.prResult.set(pr);
      this.prCliMode.set('inline');
      this.transitionToStep(4);
    } finally {
      this.isCreatingPr.set(false);
    }
  }
}


