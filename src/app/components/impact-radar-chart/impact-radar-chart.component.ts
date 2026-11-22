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
import { AuditImpactMetrics, RadarMetricAxis } from '../../models/audit.model';

interface RechartsRadarDatum {
  id: string;
  metric: string;
  fullLabel: string;
  before: number;
  after: number;
  delta: number;
  fullMark: number;
}

@Component({
  selector: 'app-impact-radar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="radar-impact-card" aria-labelledby="radar-impact-heading">
      <div class="radar-impact-card__header">
        <div>
          <div class="radar-impact-card__eyebrow">
            <span class="soft-pill soft-pill--accent">Recharts impact radar</span>
            <span class="radar-selected-pill">
              {{ selectedCount() }} of {{ totalCount() }} commits active
            </span>
          </div>
          <h2 id="radar-impact-heading" class="radar-impact-card__title">
            Before vs. after commit impact (LCP, CLS, FID &amp; Accessibility)
          </h2>
          <p class="radar-impact-card__subtitle">
            Dynamic Recharts radar chart visualizing baseline repository metrics against the projected gains from your selected atomic code commits. Toggle any commit below to update the radar projection in real time.
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
        </div>
      </div>

      <div class="radar-impact-card__grid">
        <!-- Recharts SVG Radar Canvas -->
        <div class="radar-canvas-shell">
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

          <div
            #radarContainer
            class="radar-svg-host recharts-host-container"
            role="img"
            aria-label="Recharts radar chart comparing before and after performance and accessibility metrics"
          ></div>

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
        </div>

        <!-- Metric Breakdown & Delta List -->
        <div class="radar-metrics-panel">
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
            @for (axis of activeAxes(); track axis.id) {
              <li
                class="radar-axis-row"
                [class.is-highlighted]="focusedAxis()?.id === axis.id"
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
        </div>
      </div>
    </section>
  `,
})
export class ImpactRadarChartComponent implements AfterViewInit, OnDestroy {
  readonly metrics = input.required<AuditImpactMetrics>();
  readonly selectedCount = input.required<number>();
  readonly totalCount = input.required<number>();

  @ViewChild('radarContainer', { static: true })
  private readonly radarContainer!: ElementRef<HTMLDivElement>;

  readonly viewMode = signal<'detailed' | 'categories'>('detailed');
  readonly hoveredAxisId = signal<string | null>(null);

  readonly activeAxes = computed<RadarMetricAxis[]>(() => {
    const m = this.metrics();
    return this.viewMode() === 'detailed' ? m.detailedAxes : m.categoryAxes;
  });

  readonly focusedAxis = computed<RadarMetricAxis | null>(() => {
    const axes = this.activeAxes();
    const hovered = this.hoveredAxisId();
    if (hovered) {
      return axes.find((a) => a.id === hovered) ?? axes[0] ?? null;
    }
    return axes[0] ?? null;
  });

  private isViewReady = false;
  private reactRoot: Root | null = null;

  constructor() {
    effect(() => {
      const axes = this.activeAxes();
      const selCount = this.selectedCount();
      if (this.isViewReady) {
        this.renderRechartsRadar(axes, selCount);
      }
    });
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    this.renderRechartsRadar(this.activeAxes(), this.selectedCount());
  }

  ngOnDestroy(): void {
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
  }

  setViewMode(mode: 'detailed' | 'categories'): void {
    this.viewMode.set(mode);
    this.hoveredAxisId.set(null);
  }

  private renderRechartsRadar(axes: RadarMetricAxis[], selectedCount: number): void {
    const hostEl = this.radarContainer?.nativeElement;
    if (!hostEl || typeof window === 'undefined' || axes.length < 3) return;

    if (!this.reactRoot) {
      this.reactRoot = createRoot(hostEl);
    }

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
        name: 'Before (Baseline)',
        dataKey: 'before',
        stroke: '#94a3b8',
        strokeWidth: 1.8,
        strokeDasharray: '5 4',
        fill: '#94a3b8',
        fillOpacity: 0.18,
        isAnimationActive: true,
        animationDuration: 320,
      }),
      React.createElement(Radar, {
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
        animationDuration: 380,
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
