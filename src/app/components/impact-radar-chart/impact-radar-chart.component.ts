import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import * as React from 'react';
import { Root, createRoot } from 'react-dom/client';
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Tooltip,
} from 'recharts';
import {
  AuditImpactMetrics,
  RadarMetricAxis,
  SavedAuditHistoryRecord,
} from '../../models/audit.model';

interface RechartsRadarDatum {
  id: string;
  metric: string;
  fullLabel: string;
  before: number;
  after: number;
  delta: number;
  session1?: number;
  session2?: number;
  session3?: number;
  runAAfter?: number;
  runBAfter?: number;
  runAGain?: number;
  runBGain?: number;
  fullMark: number;
}

export interface HistoryTrajectorySession {
  id: string;
  slotKey: 'session1' | 'session2' | 'session3';
  title: string;
  sourceBadge: string;
  isFirestoreBacked: boolean;
  timestampLabel: string;
  commitsLabel: string;
  performanceScore: number;
  accessibilityScore: number;
  lcpScore: number;
  clsScore: number;
  fidScore: number;
  wcagAriaScore: number;
}

export interface HistoryTrajectoryAxisRow {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  s1: number;
  s2: number;
  s3: number;
  totalGain: number;
}

export interface RadarComparableRunOption {
  id: string;
  title: string;
  sourceBadge: string;
  repoFullName: string;
  timestampLabel: string;
  commitsLabel: string;
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  lcpBefore: number;
  lcpAfter: number;
  clsBefore: number;
  clsAfter: number;
  fidBefore: number;
  fidAfter: number;
  wcagBefore: number;
  wcagAfter: number;
}

export interface RadarCompareAxisRow {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  baseline: number;
  runABefore: number;
  runAAfter: number;
  runAGain: number;
  runBBefore: number;
  runBAfter: number;
  runBGain: number;
  afterDelta: number;
  gainDelta: number;
}

@Component({
  selector: 'app-impact-radar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="radar-impact-card"
      [class.is-entering]="isEntering()"
      aria-labelledby="radar-impact-heading"
    >
      <div class="radar-impact-card__header">
        <div>
          <div class="radar-impact-card__eyebrow">
            <span class="soft-pill soft-pill--accent">
              @if (viewMode() === 'history') {
                Firestore performance trajectory
              } @else if (viewMode() === 'compare') {
                Side-by-side radar run comparison
              } @else {
                Recharts impact radar
              }
            </span>
            @if (viewMode() === 'history') {
              <span class="radar-selected-pill">
                {{ repoFirestoreSessions().length }} Firestore
                {{ repoFirestoreSessions().length === 1 ? 'snapshot' : 'snapshots' }} ·
                {{ historySessions().length }} trajectory stages
              </span>
            } @else if (viewMode() === 'compare') {
              <span class="radar-selected-pill">
                {{ comparableRunOptions().length }} history runs available
              </span>
            } @else {
              <span class="radar-selected-pill">
                {{ selectedCount() }} of {{ totalCount() }} commits active
              </span>
            }
          </div>
          <h2 id="radar-impact-heading" class="radar-impact-card__title">
            @if (viewMode() === 'history') {
              Multi-session performance &amp; accessibility trajectory ({{ repoFullName() }})
            } @else if (viewMode() === 'compare') {
              Side-by-side audit run comparison on Recharts radar ({{ selectedCompareRunA().title }} vs. {{ selectedCompareRunB().title }})
            } @else {
              Before vs. after commit impact (LCP, CLS, FID &amp; Accessibility)
            }
          </h2>
          <p class="radar-impact-card__subtitle">
            @if (viewMode() === 'history') {
              Visualizes how {{ repoFullName() }} evolved across past Firestore audit sessions—from initial baseline inspection through saved historical runs to your current active session.
            } @else if (viewMode() === 'compare') {
              Select any two audit runs from your history below to overlay and compare their performance and accessibility improvements side-by-side on the Recharts radar chart.
            } @else {
              Dynamic Recharts radar chart visualizing baseline repository metrics against the projected gains from your selected atomic code commits. Toggle any commit below to update the radar projection in real time.
            }
          </p>
        </div>

        <div class="radar-mode-tabs" role="tablist" aria-label="Radar chart dimension mode">
          <button
            type="button"
            class="radar-mode-tab"
            [class.is-active]="viewMode() === 'detailed'"
            role="tab"
            [attr.aria-selected]="viewMode() === 'detailed'"
            (click)="setViewMode('detailed')"
          >
            LCP, CLS, FID &amp; Accessibility (6 axes)
          </button>
          <button
            type="button"
            class="radar-mode-tab"
            [class.is-active]="viewMode() === 'categories'"
            role="tab"
            [attr.aria-selected]="viewMode() === 'categories'"
            (click)="setViewMode('categories')"
          >
            All Categories ({{ metrics().categoryAxes.length }} axes)
          </button>
          <button
            type="button"
            id="radar-history-tab"
            class="radar-mode-tab radar-mode-tab--history"
            [class.is-active]="viewMode() === 'history'"
            role="tab"
            [attr.aria-selected]="viewMode() === 'history'"
            (click)="setViewMode('history')"
          >
            <span>History ({{ historySessions().length }} sessions)</span>
          </button>
          <button
            type="button"
            id="radar-compare-runs-toggle-btn"
            class="radar-mode-tab radar-mode-tab--compare"
            [class.is-active]="viewMode() === 'compare' || isCompareDrawerOpen()"
            role="tab"
            [attr.aria-selected]="viewMode() === 'compare'"
            [attr.aria-expanded]="isCompareDrawerOpen()"
            aria-controls="radar-expandable-compare-drawer"
            (click)="toggleCompareDrawer()"
          >
            <span>{{ isCompareDrawerOpen() ? 'Hide comparison' : 'Compare 2 runs' }}</span>
          </button>
        </div>
      </div>

      <!-- Expandable Two-Run Comparison Selector Bar inside the Radar Chart Card -->
      @if (isCompareDrawerOpen() || viewMode() === 'compare') {
        <div
          id="radar-expandable-compare-drawer"
          class="radar-compare-drawer"
          role="region"
          aria-label="Select two audit runs from history to compare on the radar chart"
        >
          <div class="radar-compare-drawer__head">
            <div class="radar-compare-drawer__title-wrap">
              <span class="soft-pill soft-pill--accent">Expandable radar comparison</span>
              <span class="radar-compare-drawer__hint">
                Pick any two saved Firestore or session audit runs to compare their performance &amp; accessibility improvements side-by-side on the radar chart.
              </span>
            </div>
            <div class="radar-compare-drawer__actions">
              <button
                type="button"
                id="radar-swap-compare-runs-btn"
                class="export-pill-btn export-pill-btn--ghost"
                (click)="swapCompareRuns()"
              >
                <span>⇄ Swap Run A / Run B</span>
              </button>
              @if (isAuthenticated()) {
                <button
                  type="button"
                  class="radar-history-sync-btn"
                  [disabled]="isLoadingHistory()"
                  (click)="onRefreshHistory()"
                >
                  <span>{{ isLoadingHistory() ? 'Syncing...' : 'Sync Firestore runs' }}</span>
                </button>
              }
            </div>
          </div>

          <div class="radar-compare-selectors">
            <div class="radar-compare-select-card radar-compare-select-card--a">
              <div class="radar-compare-select-card__top">
                <span class="run-slot-badge run-slot-badge--a">Audit Run A</span>
                <span class="run-source-tag">{{ selectedCompareRunA().sourceBadge }}</span>
              </div>
              <label class="sr-only" for="radar-compare-select-a">Select first audit run for radar comparison</label>
              <select
                id="radar-compare-select-a"
                class="run-select-input"
                [value]="selectedCompareRunA().id"
                (change)="onSelectCompareRunA($event)"
              >
                @for (opt of comparableRunOptions(); track opt.id) {
                  <option [value]="opt.id" [selected]="opt.id === selectedCompareRunA().id">
                    {{ opt.title }} — Perf {{ opt.performanceBefore }}→{{ opt.performanceAfter }} · A11y {{ opt.accessibilityBefore }}→{{ opt.accessibilityAfter }}
                  </option>
                }
              </select>
              <div class="radar-compare-select-card__meta">
                <span>Perf <strong>{{ selectedCompareRunA().performanceBefore }}→{{ selectedCompareRunA().performanceAfter }}</strong> (+{{ selectedCompareRunA().performanceAfter - selectedCompareRunA().performanceBefore }})</span>
                <span>·</span>
                <span>A11y <strong>{{ selectedCompareRunA().accessibilityBefore }}→{{ selectedCompareRunA().accessibilityAfter }}</strong> (+{{ selectedCompareRunA().accessibilityAfter - selectedCompareRunA().accessibilityBefore }})</span>
                <span>·</span>
                <span>{{ selectedCompareRunA().commitsLabel }}</span>
              </div>
            </div>

            <div class="radar-compare-select-card radar-compare-select-card--b">
              <div class="radar-compare-select-card__top">
                <span class="run-slot-badge run-slot-badge--b">Audit Run B</span>
                <span class="run-source-tag run-source-tag--accent">{{ selectedCompareRunB().sourceBadge }}</span>
              </div>
              <label class="sr-only" for="radar-compare-select-b">Select second audit run for radar comparison</label>
              <select
                id="radar-compare-select-b"
                class="run-select-input"
                [value]="selectedCompareRunB().id"
                (change)="onSelectCompareRunB($event)"
              >
                @for (opt of comparableRunOptions(); track opt.id) {
                  <option [value]="opt.id" [selected]="opt.id === selectedCompareRunB().id">
                    {{ opt.title }} — Perf {{ opt.performanceBefore }}→{{ opt.performanceAfter }} · A11y {{ opt.accessibilityBefore }}→{{ opt.accessibilityAfter }}
                  </option>
                }
              </select>
              <div class="radar-compare-select-card__meta">
                <span>Perf <strong>{{ selectedCompareRunB().performanceBefore }}→{{ selectedCompareRunB().performanceAfter }}</strong> (+{{ selectedCompareRunB().performanceAfter - selectedCompareRunB().performanceBefore }})</span>
                <span>·</span>
                <span>A11y <strong>{{ selectedCompareRunB().accessibilityBefore }}→{{ selectedCompareRunB().accessibilityAfter }}</strong> (+{{ selectedCompareRunB().accessibilityAfter - selectedCompareRunB().accessibilityBefore }})</span>
                <span>·</span>
                <span>{{ selectedCompareRunB().commitsLabel }}</span>
              </div>
            </div>
          </div>
        </div>
      }

      <div class="radar-impact-card__grid">
        <!-- Recharts SVG Radar Canvas -->
        <div class="radar-canvas-shell" [class.is-entering]="isEntering()">
          @if (viewMode() === 'history') {
            <div class="radar-legend" aria-label="Historical radar trajectory legend">
              @for (s of historySessions(); track s.id) {
                <span class="radar-legend__item">
                  <span
                    class="radar-legend__swatch"
                    [class.radar-legend__swatch--s1]="s.slotKey === 'session1'"
                    [class.radar-legend__swatch--s2]="s.slotKey === 'session2'"
                    [class.radar-legend__swatch--s3]="s.slotKey === 'session3'"
                    aria-hidden="true"
                  ></span>
                  <span>{{ s.title }} ({{ s.performanceScore }} Perf)</span>
                </span>
              }
            </div>
          } @else if (viewMode() === 'compare') {
            <div class="radar-legend" aria-label="Side-by-side audit run radar comparison legend">
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--s1" aria-hidden="true"></span>
                <span>Baseline</span>
              </span>
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--s2" aria-hidden="true"></span>
                <span>Run A: {{ selectedCompareRunA().title }} ({{ selectedCompareRunA().performanceAfter }} Perf)</span>
              </span>
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--s3" aria-hidden="true"></span>
                <span>Run B: {{ selectedCompareRunB().title }} ({{ selectedCompareRunB().performanceAfter }} Perf)</span>
              </span>
            </div>
          } @else {
            <div class="radar-legend" aria-label="Radar chart legend">
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--before" aria-hidden="true"></span>
                <span>Before (baseline)</span>
              </span>
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--after" aria-hidden="true"></span>
                <span>After ({{ selectedCount() }} selected commits)</span>
              </span>
            </div>
          }

          <div
            #radarContainer
            class="radar-svg-host recharts-host-container"
            [class.is-animating-entrance]="isEntering()"
            role="img"
            [attr.aria-label]="
              viewMode() === 'history'
                ? 'Recharts radar chart visualizing multi-session performance trajectory for ' + repoFullName()
                : viewMode() === 'compare'
                  ? 'Recharts radar chart comparing ' + selectedCompareRunA().title + ' and ' + selectedCompareRunB().title
                  : 'Recharts radar chart comparing before and after performance and accessibility metrics'
            "
          ></div>

          @if (viewMode() === 'history') {
            @if (focusedHistoryAxis(); as hAxis) {
              <div class="radar-axis-spotlight" aria-live="polite">
                <div class="radar-axis-spotlight__top">
                  <strong>{{ hAxis.label }}</strong>
                  <span class="radar-axis-spotlight__scores">
                    <span class="score-before">{{ hAxis.s1 }}</span>
                    <span aria-hidden="true">→</span>
                    <span class="score-mid">{{ hAxis.s2 }}</span>
                    <span aria-hidden="true">→</span>
                    <span class="score-after">{{ hAxis.s3 }}</span>
                    <span class="score-delta">+{{ hAxis.totalGain }} pts trajectory</span>
                  </span>
                </div>
                <p class="radar-axis-spotlight__desc">{{ hAxis.description }}</p>
              </div>
            }
          } @else if (viewMode() === 'compare') {
            @if (focusedCompareAxis(); as cAxis) {
              <div class="radar-axis-spotlight" aria-live="polite">
                <div class="radar-axis-spotlight__top">
                  <strong>{{ cAxis.label }}</strong>
                  <span class="radar-axis-spotlight__scores">
                    <span class="score-mid">Run A: {{ cAxis.runAAfter }} (+{{ cAxis.runAGain }})</span>
                    <span aria-hidden="true">vs.</span>
                    <span class="score-after">Run B: {{ cAxis.runBAfter }} (+{{ cAxis.runBGain }})</span>
                    <span class="score-delta">
                      {{ cAxis.afterDelta >= 0 ? '+' : '' }}{{ cAxis.afterDelta }} pts (B vs A)
                    </span>
                  </span>
                </div>
                <p class="radar-axis-spotlight__desc">{{ cAxis.description }}</p>
              </div>
            }
          } @else {
            @if (focusedAxis(); as active) {
              <div class="radar-axis-spotlight" aria-live="polite">
                <div class="radar-axis-spotlight__top">
                  <strong>{{ active.label }}</strong>
                  <span class="radar-axis-spotlight__scores">
                    <span class="score-before">{{ active.before }}</span>
                    <span aria-hidden="true">→</span>
                    <span class="score-after">{{ active.after }}</span>
                    <span class="score-delta">+{{ active.delta }} {{ active.unit }}</span>
                  </span>
                </div>
                <p class="radar-axis-spotlight__desc">{{ active.description }}</p>
              </div>
            }
          }
        </div>

        <!-- Right Panel: Standard Before/After, History Trajectory, OR Side-by-Side Two-Run Comparison -->
        <div class="radar-metrics-panel" [class.is-entering]="isEntering()">
          @if (viewMode() === 'history') {
            <div class="radar-history-source-bar">
              <div class="radar-history-source-bar__info">
                <span class="radar-history-source-bar__dot" aria-hidden="true"></span>
                <span>
                  @if (repoFirestoreSessions().length > 0) {
                    Synced with <strong>{{ repoFirestoreSessions().length }}</strong> saved Firestore
                    {{ repoFirestoreSessions().length === 1 ? 'session' : 'sessions' }} for
                    <code>{{ repoFullName() }}</code>
                  } @else if (savedAudits().length > 0) {
                    Showing trajectory with <strong>{{ savedAudits().length }}</strong> Firestore profile
                    {{ savedAudits().length === 1 ? 'snapshot' : 'snapshots' }}
                  } @else {
                    Showing baseline-to-current trajectory (save audits to Firestore to add live checkpoints)
                  }
                </span>
              </div>

              @if (isAuthenticated()) {
                <button
                  type="button"
                  class="radar-history-sync-btn"
                  [disabled]="isLoadingHistory()"
                  (click)="onRefreshHistory()"
                >
                  <span>{{ isLoadingHistory() ? 'Syncing...' : 'Sync Firestore' }}</span>
                </button>
              }
            </div>

            <!-- Chronological Session Checkpoints -->
            <div class="radar-history-timeline" aria-label="Audit session trajectory checkpoints">
              @for (s of historySessions(); track s.id; let idx = $index) {
                <div
                  class="radar-history-session-chip"
                  [class.is-s1]="s.slotKey === 'session1'"
                  [class.is-s2]="s.slotKey === 'session2'"
                  [class.is-s3]="s.slotKey === 'session3'"
                >
                  <div class="radar-history-session-chip__top">
                    <span class="radar-history-session-chip__step">Session {{ idx + 1 }}</span>
                    <span class="radar-history-session-chip__badge">{{ s.sourceBadge }}</span>
                  </div>
                  <strong class="radar-history-session-chip__title">{{ s.title }}</strong>
                  <div class="radar-history-session-chip__scores">
                    <span>Perf <strong>{{ s.performanceScore }}</strong></span>
                    <span>·</span>
                    <span>A11y <strong>{{ s.accessibilityScore }}</strong></span>
                    <span>·</span>
                    <span>LCP <strong>{{ s.lcpScore }}</strong></span>
                  </div>
                  <span class="radar-history-session-chip__meta">
                    {{ s.timestampLabel }} · {{ s.commitsLabel }}
                  </span>
                </div>
              }
            </div>

            <!-- 6-Axis Multi-Session Trajectory List -->
            <ul class="radar-axes-list" aria-label="Multi-session metric trajectory breakdown">
              @for (row of historyAxisRows(); track row.id; let idx = $index) {
                <li
                  class="radar-axis-row"
                  [class.is-highlighted]="focusedHistoryAxis()?.id === row.id"
                  [class.is-entering]="isEntering()"
                  [style.animation-delay.ms]="idx * 45"
                  tabindex="0"
                  (mouseenter)="hoveredAxisId.set(row.id)"
                  (mouseleave)="hoveredAxisId.set(null)"
                  (focus)="hoveredAxisId.set(row.id)"
                  (blur)="hoveredAxisId.set(null)"
                >
                  <div class="radar-axis-row__top">
                    <span class="radar-axis-row__name">{{ row.label }}</span>
                    <div class="radar-axis-row__nums">
                      <span class="radar-axis-row__before" title="Session 1">{{ row.s1 }}</span>
                      <span class="radar-axis-row__arrow" aria-hidden="true">→</span>
                      <span class="radar-axis-row__mid" title="Session 2">{{ row.s2 }}</span>
                      <span class="radar-axis-row__arrow" aria-hidden="true">→</span>
                      <span class="radar-axis-row__after" title="Latest Session">{{ row.s3 }}</span>
                      <span class="radar-axis-row__delta" [class.is-zero]="row.totalGain === 0">
                        +{{ row.totalGain }}
                      </span>
                    </div>
                  </div>
                  <div class="radar-axis-bar radar-axis-bar--history">
                    <div
                      class="radar-axis-bar__s1"
                      [style.width.%]="row.s1"
                    ></div>
                    <div
                      class="radar-axis-bar__s2"
                      [style.width.%]="row.s2"
                    ></div>
                    <div
                      class="radar-axis-bar__after"
                      [style.width.%]="row.s3"
                    ></div>
                  </div>
                </li>
              }
            </ul>
          } @else if (viewMode() === 'compare') {
            <div class="radar-headline-kpis">
              <div class="radar-kpi-box">
                <span class="radar-kpi-box__label">Performance (Run A vs. Run B)</span>
                <div class="radar-kpi-box__row">
                  <span class="radar-axis-row__mid" title="Run A After">{{ selectedCompareRunA().performanceAfter }}</span>
                  <span class="radar-kpi-box__arrow" aria-hidden="true">vs.</span>
                  <span class="radar-kpi-box__after" title="Run B After">{{ selectedCompareRunB().performanceAfter }}</span>
                  <span class="radar-kpi-box__badge">
                    {{ selectedCompareRunB().performanceAfter - selectedCompareRunA().performanceAfter >= 0 ? '+' : '' }}{{ selectedCompareRunB().performanceAfter - selectedCompareRunA().performanceAfter }} pts
                  </span>
                </div>
              </div>

              <div class="radar-kpi-box">
                <span class="radar-kpi-box__label">Accessibility (Run A vs. Run B)</span>
                <div class="radar-kpi-box__row">
                  <span class="radar-axis-row__mid" title="Run A After">{{ selectedCompareRunA().accessibilityAfter }}</span>
                  <span class="radar-kpi-box__arrow" aria-hidden="true">vs.</span>
                  <span class="radar-kpi-box__after" title="Run B After">{{ selectedCompareRunB().accessibilityAfter }}</span>
                  <span class="radar-kpi-box__badge">
                    {{ selectedCompareRunB().accessibilityAfter - selectedCompareRunA().accessibilityAfter >= 0 ? '+' : '' }}{{ selectedCompareRunB().accessibilityAfter - selectedCompareRunA().accessibilityAfter }} pts
                  </span>
                </div>
              </div>
            </div>

            <ul class="radar-axes-list" aria-label="Side-by-side Run A vs Run B radar metric breakdown">
              @for (row of compareAxisRows(); track row.id; let idx = $index) {
                <li
                  class="radar-axis-row"
                  [class.is-highlighted]="focusedCompareAxis()?.id === row.id"
                  [class.is-entering]="isEntering()"
                  [style.animation-delay.ms]="idx * 45"
                  tabindex="0"
                  (mouseenter)="hoveredAxisId.set(row.id)"
                  (mouseleave)="hoveredAxisId.set(null)"
                  (focus)="hoveredAxisId.set(row.id)"
                  (blur)="hoveredAxisId.set(null)"
                >
                  <div class="radar-axis-row__top">
                    <span class="radar-axis-row__name">{{ row.label }}</span>
                    <div class="radar-axis-row__nums">
                      <span class="radar-axis-row__mid" title="Run A After ({{ row.runABefore }}→{{ row.runAAfter }})">
                        A: {{ row.runAAfter }} (+{{ row.runAGain }})
                      </span>
                      <span class="radar-axis-row__arrow" aria-hidden="true">vs</span>
                      <span class="radar-axis-row__after" title="Run B After ({{ row.runBBefore }}→{{ row.runBAfter }})">
                        B: {{ row.runBAfter }} (+{{ row.runBGain }})
                      </span>
                      <span class="radar-axis-row__delta" [class.is-zero]="row.afterDelta === 0">
                        {{ row.afterDelta >= 0 ? '+' : '' }}{{ row.afterDelta }}
                      </span>
                    </div>
                  </div>
                  <div class="radar-axis-bar radar-axis-bar--history">
                    <div
                      class="radar-axis-bar__s1"
                      [style.width.%]="row.baseline"
                    ></div>
                    <div
                      class="radar-axis-bar__s2"
                      [style.width.%]="row.runAAfter"
                    ></div>
                    <div
                      class="radar-axis-bar__after"
                      [style.width.%]="row.runBAfter"
                    ></div>
                  </div>
                </li>
              }
            </ul>
          } @else {
            <div class="radar-headline-kpis">
              <div class="radar-kpi-box">
                <span class="radar-kpi-box__label">Performance score</span>
                <div class="radar-kpi-box__row">
                  <span class="radar-kpi-box__before">{{ metrics().performanceBefore }}</span>
                  <span class="radar-kpi-box__arrow" aria-hidden="true">→</span>
                  <span class="radar-kpi-box__after">{{ metrics().performanceAfter }}</span>
                  <span class="radar-kpi-box__badge">
                    +{{ metrics().performanceAfter - metrics().performanceBefore }} pts
                  </span>
                </div>
              </div>

              <div class="radar-kpi-box">
                <span class="radar-kpi-box__label">Accessibility score</span>
                <div class="radar-kpi-box__row">
                  <span class="radar-kpi-box__before">{{ metrics().accessibilityBefore }}</span>
                  <span class="radar-kpi-box__arrow" aria-hidden="true">→</span>
                  <span class="radar-kpi-box__after">{{ metrics().accessibilityAfter }}</span>
                  <span class="radar-kpi-box__badge">
                    +{{ metrics().accessibilityAfter - metrics().accessibilityBefore }} pts
                  </span>
                </div>
              </div>
            </div>

            <ul class="radar-axes-list" aria-label="Before vs after metric breakdown">
              @for (axis of activeAxes(); track axis.id; let idx = $index) {
                <li
                  class="radar-axis-row"
                  [class.is-highlighted]="focusedAxis()?.id === axis.id"
                  [class.is-entering]="isEntering()"
                  [style.animation-delay.ms]="idx * 45"
                  tabindex="0"
                  (mouseenter)="hoveredAxisId.set(axis.id)"
                  (mouseleave)="hoveredAxisId.set(null)"
                  (focus)="hoveredAxisId.set(axis.id)"
                  (blur)="hoveredAxisId.set(null)"
                >
                  <div class="radar-axis-row__top">
                    <span class="radar-axis-row__name">{{ axis.label }}</span>
                    <div class="radar-axis-row__nums">
                      <span class="radar-axis-row__before">{{ axis.before }}</span>
                      <span class="radar-axis-row__arrow" aria-hidden="true">→</span>
                      <span class="radar-axis-row__after">{{ axis.after }}</span>
                      <span class="radar-axis-row__delta" [class.is-zero]="axis.delta === 0">
                        +{{ axis.delta }}
                      </span>
                    </div>
                  </div>
                  <div class="radar-axis-bar">
                    <div
                      class="radar-axis-bar__before"
                      [style.width.%]="axis.before"
                    ></div>
                    <div
                      class="radar-axis-bar__after"
                      [style.width.%]="axis.after"
                    ></div>
                  </div>
                </li>
              }
            </ul>
          }
        </div>
      </div>
    </section>
  `,
})
export class ImpactRadarChartComponent implements AfterViewInit, OnDestroy {
  readonly metrics = input.required<AuditImpactMetrics>();
  readonly selectedCount = input.required<number>();
  readonly totalCount = input.required<number>();
  readonly activeCategoryTab = input<string>('all');
  readonly repoFullName = input<string>('fresnel-sandbox/lumina-web-app');
  readonly savedAudits = input<SavedAuditHistoryRecord[]>([]);
  readonly isAuthenticated = input<boolean>(false);
  readonly isLoadingHistory = input<boolean>(false);

  readonly refreshHistory = output<void>();

  @ViewChild('radarContainer', { static: true })
  private readonly radarContainer!: ElementRef<HTMLDivElement>;

  readonly viewMode = signal<'detailed' | 'categories' | 'history' | 'compare'>('detailed');
  readonly isCompareDrawerOpen = signal<boolean>(false);
  readonly compareRunAId = signal<string>('run-static-pass');
  readonly compareRunBId = signal<string>('run-active-current');
  readonly hoveredAxisId = signal<string | null>(null);
  readonly isEntering = signal<boolean>(true);
  private readonly animCycle = signal<number>(1);
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCategoryTab = 'all';

  readonly activeAxes = computed<RadarMetricAxis[]>(() => {
    const m = this.metrics();
    return this.viewMode() === 'categories' ? m.categoryAxes : m.detailedAxes;
  });

  readonly focusedAxis = computed<RadarMetricAxis | null>(() => {
    const axes = this.activeAxes();
    const hovered = this.hoveredAxisId();
    if (hovered) {
      return axes.find((a) => a.id === hovered) ?? axes[0] ?? null;
    }
    return axes[0] ?? null;
  });

  /**
   * Filters Firestore saved audit records matching the current repository,
   * sorted chronologically (oldest to newest).
   */
  readonly repoFirestoreSessions = computed<SavedAuditHistoryRecord[]>(() => {
    const repo = (this.repoFullName() || '').trim().toLowerCase();
    const allSaved = this.savedAudits() || [];
    const matching = allSaved.filter(
      (rec) => (rec.repoFullName || '').trim().toLowerCase() === repo
    );
    const pool = matching.length > 0 ? matching : allSaved;
    return [...pool].sort((a, b) =>
      String(a.updatedAtIso || '').localeCompare(String(b.updatedAtIso || ''))
    );
  });

  /**
   * Builds selectable audit run options from active session, intermediate passes,
   * and the user's saved Firestore audit history so any two runs can be compared
   * side-by-side on the existing Recharts radar chart.
   */
  readonly comparableRunOptions = computed<RadarComparableRunOption[]>(() => {
    const m = this.metrics();
    const repo = this.repoFullName();
    const selCount = this.selectedCount();
    const totCount = this.totalCount();
    const saved = this.savedAudits() || [];

    const getAxisScore = (id: string, fallbackBefore: number, fallbackAfter: number) => {
      const found = m.detailedAxes.find((a) => a.id === id);
      return {
        before: found?.before ?? fallbackBefore,
        after: found?.after ?? fallbackAfter,
      };
    };

    const lcp = getAxisScore('lcp', 56, 94);
    const cls = getAxisScore('cls', 63, 96);
    const fid = getAxisScore('fid', 62, 93);
    const wcag = getAxisScore('wcag-aria', 66, 96);

    const activeOption: RadarComparableRunOption = {
      id: 'run-active-current',
      title: `Current Active Selection (${selCount}/${totCount} commits)`,
      sourceBadge: 'Active Session · Live Radar',
      repoFullName: repo,
      timestampLabel: 'Active now',
      commitsLabel: `${selCount}/${totCount} commits`,
      performanceBefore: m.performanceBefore,
      performanceAfter: m.performanceAfter,
      accessibilityBefore: m.accessibilityBefore,
      accessibilityAfter: m.accessibilityAfter,
      lcpBefore: lcp.before,
      lcpAfter: lcp.after,
      clsBefore: cls.before,
      clsAfter: cls.after,
      fidBefore: fid.before,
      fidAfter: fid.after,
      wcagBefore: wcag.before,
      wcagAfter: wcag.after,
    };

    const staticCount = Math.max(1, Math.min(totCount, Math.ceil(totCount * 0.6)));
    const staticOption: RadarComparableRunOption = {
      id: 'run-static-pass',
      title: `Run 1 — Initial Static Audit (${staticCount}/${totCount} core commits)`,
      sourceBadge: 'Run 1 · Static Analysis',
      repoFullName: repo,
      timestampLabel: 'Initial Pass',
      commitsLabel: `${staticCount}/${totCount} commits`,
      performanceBefore: m.performanceBefore,
      performanceAfter: Math.min(96, m.performanceBefore + Math.round((95 - m.performanceBefore) * 0.62)),
      accessibilityBefore: m.accessibilityBefore,
      accessibilityAfter: Math.min(97, m.accessibilityBefore + Math.round((98 - m.accessibilityBefore) * 0.64)),
      lcpBefore: lcp.before,
      lcpAfter: Math.min(95, lcp.before + 22),
      clsBefore: cls.before,
      clsAfter: Math.min(96, cls.before + 20),
      fidBefore: fid.before,
      fidAfter: Math.min(94, fid.before + 18),
      wcagBefore: wcag.before,
      wcagAfter: Math.min(96, wcag.before + 19),
    };

    const lhrOption: RadarComparableRunOption = {
      id: 'run-lhr-full',
      title: `Run 2 — Full Lighthouse LHR Suite (${totCount}/${totCount} commits)`,
      sourceBadge: 'Run 2 · Headless Chromium + LHR',
      repoFullName: repo,
      timestampLabel: 'Full LHR Benchmark',
      commitsLabel: `${totCount}/${totCount} commits`,
      performanceBefore: m.performanceBefore,
      performanceAfter: 96,
      accessibilityBefore: m.accessibilityBefore,
      accessibilityAfter: 98,
      lcpBefore: lcp.before,
      lcpAfter: 95,
      clsBefore: cls.before,
      clsAfter: 97,
      fidBefore: fid.before,
      fidAfter: 94,
      wcagBefore: wcag.before,
      wcagAfter: 97,
    };

    const formatDateShort = (iso?: string) => {
      if (!iso) return 'Saved snapshot';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'Saved snapshot';
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const savedOptions: RadarComparableRunOption[] = saved.map((rec, idx) => {
      const perfGainRatio =
        rec.performanceAfter > rec.performanceBefore
          ? (rec.performanceAfter - rec.performanceBefore) /
            Math.max(1, 96 - rec.performanceBefore)
          : 0.65;
      const a11yGainRatio =
        rec.accessibilityAfter > rec.accessibilityBefore
          ? (rec.accessibilityAfter - rec.accessibilityBefore) /
            Math.max(1, 98 - rec.accessibilityBefore)
          : 0.7;

      const phaseTag = rec.runPhase === 'lhr' ? 'Run 2 LHR' : 'Run 1 Static';
      const dateStr = formatDateShort(rec.updatedAtIso);

      return {
        id: `saved-${rec.auditId || idx}`,
        title: `Saved #${idx + 1}: ${rec.repoFullName} (${phaseTag} · ${dateStr})`,
        sourceBadge: 'Firestore Saved History',
        repoFullName: rec.repoFullName,
        timestampLabel: dateStr,
        commitsLabel: `${rec.selectedCommitsCount}/${rec.totalCommitsCount} commits`,
        performanceBefore: rec.performanceBefore,
        performanceAfter: rec.performanceAfter,
        accessibilityBefore: rec.accessibilityBefore,
        accessibilityAfter: rec.accessibilityAfter,
        lcpBefore: 56,
        lcpAfter: Math.min(97, Math.round(56 + perfGainRatio * 39)),
        clsBefore: 63,
        clsAfter: Math.min(98, Math.round(63 + perfGainRatio * 34)),
        fidBefore: 62,
        fidAfter: Math.min(95, Math.round(62 + perfGainRatio * 32)),
        wcagBefore: 66,
        wcagAfter: Math.min(98, Math.round(66 + a11yGainRatio * 31)),
      };
    });

    return [activeOption, staticOption, lhrOption, ...savedOptions];
  });

  readonly selectedCompareRunA = computed<RadarComparableRunOption>(() => {
    const opts = this.comparableRunOptions();
    const id = this.compareRunAId();
    return opts.find((o) => o.id === id) ?? opts[1] ?? opts[0];
  });

  readonly selectedCompareRunB = computed<RadarComparableRunOption>(() => {
    const opts = this.comparableRunOptions();
    const id = this.compareRunBId();
    return opts.find((o) => o.id === id) ?? opts[0];
  });

  readonly compareAxisRows = computed<RadarCompareAxisRow[]>(() => {
    const a = this.selectedCompareRunA();
    const b = this.selectedCompareRunB();

    const makeRow = (
      id: string,
      label: string,
      shortLabel: string,
      description: string,
      aBefore: number,
      aAfter: number,
      bBefore: number,
      bAfter: number
    ): RadarCompareAxisRow => {
      const aGain = Math.max(0, aAfter - aBefore);
      const bGain = Math.max(0, bAfter - bBefore);
      return {
        id,
        label,
        shortLabel,
        description,
        baseline: Math.round((aBefore + bBefore) / 2),
        runABefore: aBefore,
        runAAfter: aAfter,
        runAGain: aGain,
        runBBefore: bBefore,
        runBAfter: bAfter,
        runBGain: bGain,
        afterDelta: bAfter - aAfter,
        gainDelta: bGain - aGain,
      };
    };

    return [
      makeRow(
        'lcp',
        'LCP (Largest Contentful Paint)',
        'LCP',
        'Compares hero image preload, fetchpriority="high", and critical rendering path speed between Run A and Run B.',
        a.lcpBefore,
        a.lcpAfter,
        b.lcpBefore,
        b.lcpAfter
      ),
      makeRow(
        'cls',
        'CLS (Cumulative Layout Shift)',
        'CLS',
        'Compares visual stability and layout shift elimination across intrinsic media dimensions and font-display rules.',
        a.clsBefore,
        a.clsAfter,
        b.clsBefore,
        b.clsAfter
      ),
      makeRow(
        'fid',
        'FID / INP (First Input Delay)',
        'FID',
        'Compares main-thread responsiveness and input latency reduction between the two selected audit runs.',
        a.fidBefore,
        a.fidAfter,
        b.fidBefore,
        b.fidAfter
      ),
      makeRow(
        'performance-score',
        'Performance Score',
        'Performance',
        'Compares overall Lighthouse Performance scores and net points gained between Audit Run A and Audit Run B.',
        a.performanceBefore,
        a.performanceAfter,
        b.performanceBefore,
        b.performanceAfter
      ),
      makeRow(
        'accessibility-score',
        'Accessibility Score',
        'Accessibility',
        'Compares overall Lighthouse Accessibility scores and semantic remediation gains between Audit Run A and Audit Run B.',
        a.accessibilityBefore,
        a.accessibilityAfter,
        b.accessibilityBefore,
        b.accessibilityAfter
      ),
      makeRow(
        'wcag-aria',
        'WCAG Contrast & ARIA Semantics',
        'WCAG & ARIA',
        'Compares WCAG 2.2 AA contrast ratio compliance, ARIA labeling, and keyboard focus navigation between both runs.',
        a.wcagBefore,
        a.wcagAfter,
        b.wcagBefore,
        b.wcagAfter
      ),
    ];
  });

  readonly focusedCompareAxis = computed<RadarCompareAxisRow | null>(() => {
    const rows = this.compareAxisRows();
    const hovered = this.hoveredAxisId();
    if (hovered) {
      return rows.find((r) => r.id === hovered) ?? rows[0] ?? null;
    }
    return rows[0] ?? null;
  });

  /**
   * Builds 3 chronological trajectory stages for the repository combining
   * historical Firestore snapshots and the active session metrics.
   */
  readonly historySessions = computed<HistoryTrajectorySession[]>(() => {
    const m = this.metrics();
    const firestoreList = this.repoFirestoreSessions();
    const selCount = this.selectedCount();
    const totCount = this.totalCount();

    const getDetailedAxis = (id: string, fallbackBefore: number, fallbackAfter: number) => {
      const axis = m.detailedAxes.find((a) => a.id === id);
      return {
        before: axis?.before ?? fallbackBefore,
        after: axis?.after ?? fallbackAfter,
      };
    };

    const lcp = getDetailedAxis('lcp', 56, 94);
    const cls = getDetailedAxis('cls', 63, 96);
    const fid = getDetailedAxis('fid', 62, 93);
    const wcag = getDetailedAxis('wcag-aria', 66, 96);

    const formatDateShort = (iso?: string, fallback = 'Past session') => {
      if (!iso) return fallback;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return fallback;
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const mapFirestoreRecordToSession = (
      rec: SavedAuditHistoryRecord,
      slotKey: 'session1' | 'session2',
      fallbackTitle: string
    ): HistoryTrajectorySession => {
      const perfGainRatio =
        rec.performanceAfter > rec.performanceBefore
          ? (rec.performanceAfter - rec.performanceBefore) /
            Math.max(1, 96 - rec.performanceBefore)
          : 0.65;
      const a11yGainRatio =
        rec.accessibilityAfter > rec.accessibilityBefore
          ? (rec.accessibilityAfter - rec.accessibilityBefore) /
            Math.max(1, 98 - rec.accessibilityBefore)
          : 0.7;

      return {
        id: `hist-${slotKey}-${rec.auditId}`,
        slotKey,
        title: fallbackTitle,
        sourceBadge:
          rec.runPhase === 'lhr' ? 'Firestore · Run 2 LHR' : 'Firestore · Run 1 Static',
        isFirestoreBacked: true,
        timestampLabel: formatDateShort(rec.updatedAtIso),
        commitsLabel: `${rec.selectedCommitsCount}/${rec.totalCommitsCount} commits`,
        performanceScore: rec.performanceAfter,
        accessibilityScore: rec.accessibilityAfter,
        lcpScore: Math.min(97, Math.round(lcp.before + perfGainRatio * 38)),
        clsScore: Math.min(98, Math.round(cls.before + perfGainRatio * 33)),
        fidScore: Math.min(95, Math.round(fid.before + perfGainRatio * 31)),
        wcagAriaScore: Math.min(98, Math.round(wcag.before + a11yGainRatio * 30)),
      };
    };

    // Stage 1: Earliest baseline or oldest Firestore session
    const session1: HistoryTrajectorySession =
      firestoreList.length >= 2
        ? mapFirestoreRecordToSession(
            firestoreList[0],
            'session1',
            'Earliest Firestore Audit'
          )
        : {
            id: 'hist-session1-baseline',
            slotKey: 'session1',
            title: 'Initial Baseline Audit',
            sourceBadge: 'Run 0 · Unpatched Baseline',
            isFirestoreBacked: false,
            timestampLabel: 'Initial scan',
            commitsLabel: `0/${totCount} commits`,
            performanceScore: m.performanceBefore,
            accessibilityScore: m.accessibilityBefore,
            lcpScore: lcp.before,
            clsScore: cls.before,
            fidScore: fid.before,
            wcagAriaScore: wcag.before,
          };

    // Stage 2: Most recent saved Firestore session (or intermediate Run 1 Static checkpoint)
    const latestFirestore =
      firestoreList.length >= 1 ? firestoreList[firestoreList.length - 1] : null;

    const session2: HistoryTrajectorySession = latestFirestore
      ? mapFirestoreRecordToSession(
          latestFirestore,
          'session2',
          'Saved Firestore Snapshot'
        )
      : {
          id: 'hist-session2-intermediate',
          slotKey: 'session2',
          title: 'Prior Static Audit Pass',
          sourceBadge: 'Run 1 · Core Fixes',
          isFirestoreBacked: false,
          timestampLabel: 'Previous run',
          commitsLabel: `${Math.max(1, Math.floor(totCount * 0.6))}/${totCount} commits`,
          performanceScore: Math.round(
            m.performanceBefore + (m.performanceAfter - m.performanceBefore) * 0.62
          ),
          accessibilityScore: Math.round(
            m.accessibilityBefore + (m.accessibilityAfter - m.accessibilityBefore) * 0.64
          ),
          lcpScore: Math.round(lcp.before + (lcp.after - lcp.before) * 0.62),
          clsScore: Math.round(cls.before + (cls.after - cls.before) * 0.6),
          fidScore: Math.round(fid.before + (fid.after - fid.before) * 0.58),
          wcagAriaScore: Math.round(wcag.before + (wcag.after - wcag.before) * 0.65),
        };

    // Stage 3: Current active session projection
    const session3: HistoryTrajectorySession = {
      id: 'hist-session3-current',
      slotKey: 'session3',
      title: 'Current Active Session',
      sourceBadge: 'Live Report Projection',
      isFirestoreBacked: false,
      timestampLabel: 'Active now',
      commitsLabel: `${selCount}/${totCount} commits`,
      performanceScore: m.performanceAfter,
      accessibilityScore: m.accessibilityAfter,
      lcpScore: lcp.after,
      clsScore: cls.after,
      fidScore: fid.after,
      wcagAriaScore: wcag.after,
    };

    return [session1, session2, session3];
  });

  readonly historyAxisRows = computed<HistoryTrajectoryAxisRow[]>(() => {
    const sessions = this.historySessions();
    if (sessions.length < 3) return [];
    const [s1, s2, s3] = sessions;

    const makeRow = (
      id: string,
      label: string,
      shortLabel: string,
      description: string,
      v1: number,
      v2: number,
      v3: number
    ): HistoryTrajectoryAxisRow => ({
      id,
      label,
      shortLabel,
      description,
      s1: v1,
      s2: v2,
      s3: v3,
      totalGain: Math.max(0, v3 - v1),
    });

    return [
      makeRow(
        'lcp',
        'LCP (Largest Contentful Paint)',
        'LCP',
        'Multi-session trajectory for Largest Contentful Paint resource prioritization and hero image decoding.',
        s1.lcpScore,
        s2.lcpScore,
        s3.lcpScore
      ),
      makeRow(
        'cls',
        'CLS (Cumulative Layout Shift)',
        'CLS',
        'Historical layout stability progression across intrinsic media dimensions and font-display: swap.',
        s1.clsScore,
        s2.clsScore,
        s3.clsScore
      ),
      makeRow(
        'fid',
        'FID / INP (First Input Delay)',
        'FID',
        'Main-thread responsiveness trajectory across past audit sessions after eliminating render-blocking assets.',
        s1.fidScore,
        s2.fidScore,
        s3.fidScore
      ),
      makeRow(
        'performance-score',
        'Performance Score',
        'Performance',
        'Overall Lighthouse Performance trajectory from initial repository baseline through saved Firestore sessions.',
        s1.performanceScore,
        s2.performanceScore,
        s3.performanceScore
      ),
      makeRow(
        'accessibility-score',
        'Accessibility Score',
        'Accessibility',
        'Overall Lighthouse Accessibility score trajectory across saved Firestore audit runs.',
        s1.accessibilityScore,
        s2.accessibilityScore,
        s3.accessibilityScore
      ),
      makeRow(
        'wcag-aria',
        'WCAG Contrast & ARIA Semantics',
        'WCAG & ARIA',
        'Historical compliance trajectory for WCAG 2.2 AA contrast ratios, ARIA labels, and landmark structure.',
        s1.wcagAriaScore,
        s2.wcagAriaScore,
        s3.wcagAriaScore
      ),
    ];
  });

  readonly focusedHistoryAxis = computed<HistoryTrajectoryAxisRow | null>(() => {
    const rows = this.historyAxisRows();
    const hovered = this.hoveredAxisId();
    if (hovered) {
      return rows.find((r) => r.id === hovered) ?? rows[0] ?? null;
    }
    return rows[0] ?? null;
  });

  private isViewReady = false;
  private reactRoot: Root | null = null;

  constructor() {
    effect(() => {
      const catTab = this.activeCategoryTab();
      if (this.isViewReady && catTab !== this.lastCategoryTab) {
        this.lastCategoryTab = catTab;
        if (catTab === 'performance' && this.viewMode() !== 'categories') {
          this.hoveredAxisId.set('lcp');
        } else if (catTab === 'accessibility' && this.viewMode() !== 'categories') {
          this.hoveredAxisId.set('accessibility-score');
        } else if (catTab !== 'all' && this.viewMode() === 'categories') {
          this.hoveredAxisId.set(`cat-${catTab}`);
        }
        this.triggerEntranceAnimation();
      }
    });

    effect(() => {
      const mode = this.viewMode();
      const axes = this.activeAxes();
      const histRows = this.historyAxisRows();
      const histSessions = this.historySessions();
      const compareRows = this.compareAxisRows();
      const runA = this.selectedCompareRunA();
      const runB = this.selectedCompareRunB();
      const selCount = this.selectedCount();
      const cycle = this.animCycle();
      if (this.isViewReady) {
        this.renderRechartsRadar(
          mode,
          axes,
          histRows,
          histSessions,
          compareRows,
          runA,
          runB,
          selCount,
          cycle
        );
      }
    });
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    this.lastCategoryTab = this.activeCategoryTab();
    this.triggerEntranceAnimation();
    this.renderRechartsRadar(
      this.viewMode(),
      this.activeAxes(),
      this.historyAxisRows(),
      this.historySessions(),
      this.compareAxisRows(),
      this.selectedCompareRunA(),
      this.selectedCompareRunB(),
      this.selectedCount(),
      this.animCycle()
    );
  }

  ngOnDestroy(): void {
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
      this.enterTimer = null;
    }
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
  }

  setViewMode(mode: 'detailed' | 'categories' | 'history' | 'compare'): void {
    if (mode === 'history' || mode === 'compare') {
      this.refreshHistory.emit();
    }
    if (mode === 'compare') {
      this.isCompareDrawerOpen.set(true);
    }
    if (this.viewMode() === mode) {
      this.triggerEntranceAnimation();
      return;
    }
    this.viewMode.set(mode);
    this.hoveredAxisId.set(null);
    this.triggerEntranceAnimation();
  }

  toggleCompareDrawer(): void {
    if (this.viewMode() === 'compare' && this.isCompareDrawerOpen()) {
      this.isCompareDrawerOpen.set(false);
      this.viewMode.set('detailed');
      this.triggerEntranceAnimation();
      return;
    }
    this.isCompareDrawerOpen.set(true);
    this.setViewMode('compare');
  }

  onSelectCompareRunA(event: Event): void {
    const val = (event.target as HTMLSelectElement | null)?.value;
    if (val) {
      this.compareRunAId.set(val);
      this.viewMode.set('compare');
      this.triggerEntranceAnimation();
    }
  }

  onSelectCompareRunB(event: Event): void {
    const val = (event.target as HTMLSelectElement | null)?.value;
    if (val) {
      this.compareRunBId.set(val);
      this.viewMode.set('compare');
      this.triggerEntranceAnimation();
    }
  }

  swapCompareRuns(): void {
    const currentA = this.selectedCompareRunA().id;
    const currentB = this.selectedCompareRunB().id;
    this.compareRunAId.set(currentB);
    this.compareRunBId.set(currentA);
    this.viewMode.set('compare');
    this.triggerEntranceAnimation();
  }

  onRefreshHistory(): void {
    this.refreshHistory.emit();
    this.triggerEntranceAnimation();
  }

  triggerEntranceAnimation(): void {
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
    }
    this.isEntering.set(false);
    this.animCycle.update((n) => n + 1);
    setTimeout(() => {
      this.isEntering.set(true);
      this.enterTimer = setTimeout(() => {
        this.isEntering.set(false);
      }, 720);
    }, 16);
  }

  private renderRechartsRadar(
    mode: 'detailed' | 'categories' | 'history' | 'compare',
    axes: RadarMetricAxis[],
    historyRows: HistoryTrajectoryAxisRow[],
    historySessions: HistoryTrajectorySession[],
    compareRows: RadarCompareAxisRow[],
    compareRunA: RadarComparableRunOption,
    compareRunB: RadarComparableRunOption,
    selectedCount: number,
    cycle: number
  ): void {
    const hostEl = this.radarContainer?.nativeElement;
    if (!hostEl || typeof window === 'undefined') return;

    if (!this.reactRoot) {
      this.reactRoot = createRoot(hostEl);
    }

    if (mode === 'compare') {
      if (compareRows.length < 3) return;

      const compareData: RechartsRadarDatum[] = compareRows.map((row) => ({
        id: row.id,
        metric: `${row.shortLabel} (${row.runAAfter} vs ${row.runBAfter})`,
        fullLabel: row.label,
        before: row.baseline,
        after: row.runBAfter,
        delta: row.afterDelta,
        runAAfter: row.runAAfter,
        runBAfter: row.runBAfter,
        runAGain: row.runAGain,
        runBGain: row.runBGain,
        fullMark: 100,
      }));

      const compareRadarElement = React.createElement(
        RadarChart,
        {
          width: 390,
          height: 320,
          cx: '50%',
          cy: '52%',
          outerRadius: 102,
          data: compareData,
        },
        React.createElement(PolarGrid, {
          stroke: 'var(--border-card)',
          strokeDasharray: '3 3',
        }),
        React.createElement(PolarAngleAxis, {
          dataKey: 'metric',
          tick: {
            fill: 'var(--text-main)',
            fontSize: 10.5,
            fontWeight: 600,
          },
        }),
        React.createElement(PolarRadiusAxis, {
          angle: 90,
          domain: [0, 100],
          tickCount: 5,
          tick: {
            fill: 'var(--text-muted)',
            fontSize: 9,
          },
        }),
        React.createElement(Radar, {
          key: `radar-cmp-base-${cycle}`,
          name: 'Unpatched Baseline',
          dataKey: 'before',
          stroke: '#94a3b8',
          strokeWidth: 1.5,
          strokeDasharray: '5 4',
          fill: '#94a3b8',
          fillOpacity: 0.12,
          isAnimationActive: true,
          animationBegin: 15,
          animationDuration: 500,
          animationEasing: 'ease-out',
        }),
        React.createElement(Radar, {
          key: `radar-cmp-a-${cycle}`,
          name: `Run A: ${compareRunA.title}`,
          dataKey: 'runAAfter',
          stroke: '#0ea5e9',
          strokeWidth: 2.2,
          strokeDasharray: '3 2',
          fill: '#0ea5e9',
          fillOpacity: 0.2,
          dot: {
            r: 3.5,
            fill: '#0ea5e9',
            stroke: 'var(--bg-card)',
            strokeWidth: 1.4,
          },
          isAnimationActive: true,
          animationBegin: 55,
          animationDuration: 600,
          animationEasing: 'ease-out',
        }),
        React.createElement(Radar, {
          key: `radar-cmp-b-${cycle}`,
          name: `Run B: ${compareRunB.title}`,
          dataKey: 'runBAfter',
          stroke: 'var(--accent-primary)',
          strokeWidth: 2.6,
          fill: 'var(--accent-primary)',
          fillOpacity: 0.25,
          dot: {
            r: 4,
            fill: 'var(--accent-primary)',
            stroke: 'var(--bg-card)',
            strokeWidth: 1.5,
          },
          isAnimationActive: true,
          animationBegin: 100,
          animationDuration: 680,
          animationEasing: 'ease-out',
        }),
        React.createElement(Tooltip, {
          contentStyle: {
            borderRadius: '14px',
            border: '1px solid var(--border-card)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text-main)',
            fontSize: '12px',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
          },
        }),
        React.createElement(Legend, {
          wrapperStyle: {
            fontSize: '11px',
            paddingTop: '6px',
          },
        })
      );

      this.reactRoot.render(compareRadarElement);
      return;
    }

    if (mode === 'history') {
      if (historyRows.length < 3 || historySessions.length < 3) return;
      const [s1, s2, s3] = historySessions;

      const historyData: RechartsRadarDatum[] = historyRows.map((row) => ({
        id: row.id,
        metric: `${row.shortLabel} (${row.s3})`,
        fullLabel: row.label,
        before: row.s1,
        after: row.s3,
        delta: row.totalGain,
        session1: row.s1,
        session2: row.s2,
        session3: row.s3,
        fullMark: 100,
      }));

      const historyRadarElement = React.createElement(
        RadarChart,
        {
          width: 390,
          height: 320,
          cx: '50%',
          cy: '52%',
          outerRadius: 104,
          data: historyData,
        },
        React.createElement(PolarGrid, {
          stroke: 'var(--border-card)',
          strokeDasharray: '3 3',
        }),
        React.createElement(PolarAngleAxis, {
          dataKey: 'metric',
          tick: {
            fill: 'var(--text-main)',
            fontSize: 11,
            fontWeight: 600,
          },
        }),
        React.createElement(PolarRadiusAxis, {
          angle: 90,
          domain: [0, 100],
          tickCount: 5,
          tick: {
            fill: 'var(--text-muted)',
            fontSize: 9,
          },
        }),
        React.createElement(Radar, {
          key: `radar-hist-s1-${cycle}`,
          name: `1. ${s1.title}`,
          dataKey: 'session1',
          stroke: '#94a3b8',
          strokeWidth: 1.6,
          strokeDasharray: '5 4',
          fill: '#94a3b8',
          fillOpacity: 0.14,
          isAnimationActive: true,
          animationBegin: 15,
          animationDuration: 520,
          animationEasing: 'ease-out',
        }),
        React.createElement(Radar, {
          key: `radar-hist-s2-${cycle}`,
          name: `2. ${s2.title}`,
          dataKey: 'session2',
          stroke: '#0ea5e9',
          strokeWidth: 2,
          strokeDasharray: '3 2',
          fill: '#0ea5e9',
          fillOpacity: 0.18,
          isAnimationActive: true,
          animationBegin: 65,
          animationDuration: 600,
          animationEasing: 'ease-out',
        }),
        React.createElement(Radar, {
          key: `radar-hist-s3-${cycle}`,
          name: `3. ${s3.title}`,
          dataKey: 'session3',
          stroke: 'var(--accent-primary)',
          strokeWidth: 2.6,
          fill: 'var(--accent-primary)',
          fillOpacity: 0.25,
          dot: {
            r: 4,
            fill: 'var(--accent-primary)',
            stroke: 'var(--bg-card)',
            strokeWidth: 1.5,
          },
          isAnimationActive: true,
          animationBegin: 115,
          animationDuration: 680,
          animationEasing: 'ease-out',
        }),
        React.createElement(Tooltip, {
          contentStyle: {
            borderRadius: '14px',
            border: '1px solid var(--border-card)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text-main)',
            fontSize: '12px',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
          },
        }),
        React.createElement(Legend, {
          wrapperStyle: {
            fontSize: '11px',
            paddingTop: '6px',
          },
        })
      );

      this.reactRoot.render(historyRadarElement);
      return;
    }

    if (axes.length < 3) return;

    const chartData: RechartsRadarDatum[] = axes.map((axis) => ({
      id: axis.id,
      metric: `${axis.shortLabel} (${axis.after})`,
      fullLabel: axis.label,
      before: axis.before,
      after: axis.after,
      delta: axis.delta,
      fullMark: 100,
    }));

    const radarElement = React.createElement(
      RadarChart,
      {
        width: 390,
        height: 320,
        cx: '50%',
        cy: '52%',
        outerRadius: 104,
        data: chartData,
      },
      React.createElement(PolarGrid, {
        stroke: 'var(--border-card)',
        strokeDasharray: '3 3',
      }),
      React.createElement(PolarAngleAxis, {
        dataKey: 'metric',
        tick: {
          fill: 'var(--text-main)',
          fontSize: 11,
          fontWeight: 600,
        },
      }),
      React.createElement(PolarRadiusAxis, {
        angle: 90,
        domain: [0, 100],
        tickCount: 5,
        tick: {
          fill: 'var(--text-muted)',
          fontSize: 9,
        },
      }),
      React.createElement(Radar, {
        key: `radar-before-${mode}-${cycle}`,
        name: 'Before (Baseline)',
        dataKey: 'before',
        stroke: '#94a3b8',
        strokeWidth: 1.8,
        strokeDasharray: '5 4',
        fill: '#94a3b8',
        fillOpacity: 0.18,
        isAnimationActive: true,
        animationBegin: 20,
        animationDuration: 560,
        animationEasing: 'ease-out',
      }),
      React.createElement(Radar, {
        key: `radar-after-${mode}-${cycle}`,
        name: `After (${selectedCount} Selected Commits)`,
        dataKey: 'after',
        stroke: 'var(--accent-primary)',
        strokeWidth: 2.5,
        fill: 'var(--accent-primary)',
        fillOpacity: 0.26,
        dot: {
          r: 4,
          fill: 'var(--accent-primary)',
          stroke: 'var(--bg-card)',
          strokeWidth: 1.5,
        },
        isAnimationActive: true,
        animationBegin: 70,
        animationDuration: 680,
        animationEasing: 'ease-out',
      }),
      React.createElement(Tooltip, {
        contentStyle: {
          borderRadius: '14px',
          border: '1px solid var(--border-card)',
          backgroundColor: 'var(--bg-card)',
          color: 'var(--text-main)',
          fontSize: '12px',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
        },
      }),
      React.createElement(Legend, {
        wrapperStyle: {
          fontSize: '11px',
          paddingTop: '6px',
        },
      })
    );

    this.reactRoot.render(radarElement);
  }
}
