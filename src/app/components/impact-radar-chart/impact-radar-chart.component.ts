import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import * as d3 from 'd3';
import { AuditImpactMetrics, RadarMetricAxis } from '../../models/audit.model';

@Component({
  selector: 'app-impact-radar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="radar-impact-card" aria-labelledby="radar-impact-heading">
      <div class="radar-impact-card__header">
        <div>
          <div class="radar-impact-card__eyebrow">
            <span class="soft-pill soft-pill--accent">D3 impact visualization</span>
            <span class="radar-selected-pill">
              {{ selectedCount() }} of {{ totalCount() }} commits active
            </span>
          </div>
          <h2 id="radar-impact-heading" class="radar-impact-card__title">
            Before vs. after commit impact
          </h2>
          <p class="radar-impact-card__subtitle">
            Dynamic radar projection comparing baseline repository metrics against the projected gains from your currently selected commits. Toggle any commit below to see its live impact.
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
            Performance &amp; Accessibility (6 axes)
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
        <!-- D3 SVG Radar Canvas -->
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

          <div #radarContainer class="radar-svg-host" role="img" aria-label="D3 radar chart comparing before and after metrics"></div>

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
              <span class="radar-kpi-box__label">Performance impact</span>
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
              <span class="radar-kpi-box__label">Accessibility impact</span>
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
export class ImpactRadarChartComponent implements AfterViewInit {
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

  constructor() {
    effect(() => {
      const axes = this.activeAxes();
      const highlightedId = this.hoveredAxisId();
      if (this.isViewReady) {
        this.renderD3Radar(axes, highlightedId);
      }
    });
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    this.renderD3Radar(this.activeAxes(), this.hoveredAxisId());
  }

  setViewMode(mode: 'detailed' | 'categories'): void {
    this.viewMode.set(mode);
    this.hoveredAxisId.set(null);
  }

  private renderD3Radar(axes: RadarMetricAxis[], highlightedId: string | null): void {
    const hostEl = this.radarContainer?.nativeElement;
    if (!hostEl || axes.length < 3) return;

    const width = 400;
    const height = 340;
    const cx = width / 2;
    const cy = height / 2 + 4;
    const maxRadius = 112;
    const ringLevels = [25, 50, 75, 100];
    const totalAxes = axes.length;
    const angleSlice = (Math.PI * 2) / totalAxes;

    const rScale = d3.scaleLinear().domain([0, 100]).range([0, maxRadius]);

    let svg = d3.select(hostEl).select<SVGSVGElement>('svg');
    if (svg.empty()) {
      svg = d3
        .select(hostEl)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('class', 'd3-radar-svg');

      svg.append('g').attr('class', 'radar-grid-group');
      svg.append('g').attr('class', 'radar-axes-group');
      svg.append('g').attr('class', 'radar-area-group');
      svg.append('g').attr('class', 'radar-dots-group');
      svg.append('g').attr('class', 'radar-labels-group');
    }

    const gridGroup = svg.select<SVGGElement>('.radar-grid-group');
    const axesGroup = svg.select<SVGGElement>('.radar-axes-group');
    const areaGroup = svg.select<SVGGElement>('.radar-area-group');
    const dotsGroup = svg.select<SVGGElement>('.radar-dots-group');
    const labelsGroup = svg.select<SVGGElement>('.radar-labels-group');

    const polarPoint = (value: number, idx: number): [number, number] => {
      const r = rScale(value);
      const angle = idx * angleSlice - Math.PI / 2;
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    };

    const polygonPointsAttr = (values: number[]): string =>
      values.map((v, i) => polarPoint(v, i).join(',')).join(' ');

    // 1. Concentric Fresnel polygon rings
    const rings = gridGroup.selectAll<SVGPolygonElement, number>('polygon.radar-ring').data(ringLevels);
    rings
      .join('polygon')
      .attr('class', 'radar-ring')
      .attr('points', (lvl) => polygonPointsAttr(axes.map(() => lvl)))
      .attr('fill', 'none')
      .attr('stroke', 'var(--border-card)')
      .attr('stroke-width', (lvl) => (lvl === 100 ? 1.5 : 1))
      .attr('stroke-dasharray', (lvl) => (lvl === 100 ? 'none' : '3,3'));

    const ringLabels = gridGroup
      .selectAll<SVGTextElement, number>('text.radar-ring-label')
      .data(ringLevels);
    ringLabels
      .join('text')
      .attr('class', 'radar-ring-label')
      .attr('x', cx + 5)
      .attr('y', (lvl) => cy - rScale(lvl) + 11)
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '9px')
      .attr('font-family', 'var(--font-mono)')
      .text((lvl) => `${lvl}`);

    // 2. Radial axis spokes
    const spokes = axesGroup
      .selectAll<SVGLineElement, RadarMetricAxis>('line.radar-spoke')
      .data(axes, (d) => d.id);
    spokes
      .join('line')
      .attr('class', 'radar-spoke')
      .attr('x1', cx)
      .attr('y1', cy)
      .attr('x2', (_, i) => polarPoint(100, i)[0])
      .attr('y2', (_, i) => polarPoint(100, i)[1])
      .attr('stroke', (d) =>
        d.id === highlightedId ? 'var(--accent-primary)' : 'var(--border-card)'
      )
      .attr('stroke-width', (d) => (d.id === highlightedId ? 2 : 1));

    // 3. Before & After radar polygons
    const lineGenerator = d3
      .lineRadial<number>()
      .curve(d3.curveLinearClosed)
      .radius((d) => rScale(d))
      .angle((_, i) => i * angleSlice);

    const beforeValues = axes.map((a) => a.before);
    const afterValues = axes.map((a) => a.after);

    let beforePath = areaGroup.select<SVGPathElement>('path.radar-poly-before');
    if (beforePath.empty()) {
      beforePath = areaGroup
        .append('path')
        .attr('class', 'radar-poly-before')
        .attr('transform', `translate(${cx}, ${cy})`)
        .attr('fill', 'rgba(148, 163, 184, 0.16)')
        .attr('stroke', 'var(--text-muted)')
        .attr('stroke-width', 1.75)
        .attr('stroke-dasharray', '5,4');
    }
    beforePath
      .transition()
      .duration(360)
      .ease(d3.easeCubicOut)
      .attr('transform', `translate(${cx}, ${cy})`)
      .attr('d', lineGenerator(beforeValues) ?? '');

    let afterPath = areaGroup.select<SVGPathElement>('path.radar-poly-after');
    if (afterPath.empty()) {
      afterPath = areaGroup
        .append('path')
        .attr('class', 'radar-poly-after')
        .attr('transform', `translate(${cx}, ${cy})`)
        .attr('fill', 'var(--accent-soft)')
        .attr('stroke', 'var(--accent-primary)')
        .attr('stroke-width', 2.6);
    }
    afterPath
      .transition()
      .duration(420)
      .ease(d3.easeCubicOut)
      .attr('transform', `translate(${cx}, ${cy})`)
      .attr('d', lineGenerator(afterValues) ?? '');

    // 4. Vertex dots for Before & After
    const beforeDots = dotsGroup
      .selectAll<SVGCircleElement, RadarMetricAxis>('circle.radar-dot-before')
      .data(axes, (d) => d.id);
    beforeDots
      .join('circle')
      .attr('class', 'radar-dot-before')
      .attr('r', 3.5)
      .attr('fill', 'var(--bg-card)')
      .attr('stroke', 'var(--text-muted)')
      .attr('stroke-width', 1.6)
      .transition()
      .duration(360)
      .attr('cx', (d, i) => polarPoint(d.before, i)[0])
      .attr('cy', (d, i) => polarPoint(d.before, i)[1]);

    const afterDots = dotsGroup
      .selectAll<SVGCircleElement, RadarMetricAxis>('circle.radar-dot-after')
      .data(axes, (d) => d.id);
    afterDots
      .join('circle')
      .attr('class', 'radar-dot-after')
      .style('cursor', 'pointer')
      .attr('fill', 'var(--accent-primary)')
      .attr('stroke', 'var(--bg-card)')
      .attr('stroke-width', 1.8)
      .on('mouseenter', (_, d) => this.hoveredAxisId.set(d.id))
      .on('mouseleave', () => this.hoveredAxisId.set(null))
      .transition()
      .duration(420)
      .ease(d3.easeCubicOut)
      .attr('r', (d) => (d.id === highlightedId ? 6.5 : 4.8))
      .attr('cx', (d, i) => polarPoint(d.after, i)[0])
      .attr('cy', (d, i) => polarPoint(d.after, i)[1]);

    // 5. Perimeter Axis Labels
    const labelPoints = axes.map((axis, i) => {
      const [lx, ly] = polarPoint(123, i);
      const angleDeg = ((i * angleSlice - Math.PI / 2) * 180) / Math.PI;
      let anchor = 'middle';
      if (Math.cos((angleDeg * Math.PI) / 180) > 0.25) anchor = 'start';
      else if (Math.cos((angleDeg * Math.PI) / 180) < -0.25) anchor = 'end';
      return { axis, lx, ly, anchor };
    });

    const axisLabels = labelsGroup
      .selectAll<SVGTextElement, (typeof labelPoints)[number]>('text.radar-axis-label')
      .data(labelPoints, (d) => d.axis.id);

    axisLabels
      .join('text')
      .attr('class', 'radar-axis-label')
      .style('cursor', 'pointer')
      .attr('x', (d) => d.lx)
      .attr('y', (d) => d.ly + 4)
      .attr('text-anchor', (d) => d.anchor)
      .attr('fill', (d) =>
        d.axis.id === highlightedId ? 'var(--accent-primary)' : 'var(--text-main)'
      )
      .attr('font-size', '11px')
      .attr('font-weight', (d) => (d.axis.id === highlightedId ? '700' : '600'))
      .attr('font-family', 'var(--font-sans)')
      .text((d) => `${d.axis.shortLabel} (${d.axis.after})`)
      .on('mouseenter', (_, d) => this.hoveredAxisId.set(d.axis.id))
      .on('mouseleave', () => this.hoveredAxisId.set(null));
  }
}
