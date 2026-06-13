/**
 * AI dashboard widget'ų renderer'is (Iter 17, eksperimentinis).
 *
 * Atvaizduoja `AiWidget` (deklaratyvus JSON iš LLM, validuotas serveryje per
 * `validateDashboardSpec`) į React komponentus: stat / bar / line / area /
 * pie / table / progress / markdown.
 *
 * Defensyvumas: nors serveris sanitizuoja, čia irgi viskas optional-safe —
 * trūkstami laukai tyliai praleidžiami, render'as niekada nemeta.
 */
import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from 'recharts';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { AiValueFormat, AiWidget } from '@biip-finansai/shared';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Paletė — sutampa su system prompt'o paletėje deklaruotomis spalvomis. */
export const AI_PALETTE = [
  '#0f766e',
  '#0369a1',
  '#b45309',
  '#7c3aed',
  '#15803d',
  '#be123c',
  '#475569',
  '#0891b2',
];

const MONTH_LABELS = [
  'Sau',
  'Vas',
  'Kov',
  'Bal',
  'Geg',
  'Bir',
  'Lie',
  'Rgp',
  'Rgs',
  'Spa',
  'Lap',
  'Grd',
];

function formatAxisLabel(value: unknown): string {
  const s = String(value ?? '');
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && m[1] && m[2]) {
    const idx = Number(m[2]) - 1;
    const label = MONTH_LABELS[idx];
    if (label) return `${label} ${m[1].slice(2)}`;
  }
  return s.length > 18 ? `${s.slice(0, 17)}…` : s;
}

export function formatValue(value: unknown, format?: AiValueFormat): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    switch (format) {
      case 'eur':
        return `${value.toLocaleString('lt-LT', { maximumFractionDigits: value % 1 === 0 ? 0 : 2 })} €`;
      case 'percent':
        return `${value.toLocaleString('lt-LT', { maximumFractionDigits: 1 })}%`;
      default:
        return value.toLocaleString('lt-LT');
    }
  }
  return String(value);
}

function seriesColor(explicit: string | undefined, idx: number): string {
  return explicit ?? AI_PALETTE[idx % AI_PALETTE.length] ?? '#0f766e';
}

// ---------- Stat ----------

function StatWidget({ widget }: { widget: AiWidget }): JSX.Element {
  const trend = widget.trend;
  const TrendIcon =
    trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : Minus;
  const trendColor =
    trend?.positive === true
      ? 'text-emerald-600'
      : trend?.positive === false
        ? 'text-rose-600'
        : 'text-muted-foreground';
  return (
    <div className="flex h-full flex-col justify-between gap-1 p-4">
      {widget.title ? (
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {widget.title}
        </div>
      ) : null}
      <div className="text-2xl font-semibold tabular-nums leading-tight">{widget.value ?? '—'}</div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {widget.subtitle ? <span className="truncate">{widget.subtitle}</span> : null}
        {trend ? (
          <span className={cn('inline-flex shrink-0 items-center gap-1', trendColor)}>
            <TrendIcon className="h-3.5 w-3.5" />
            {trend.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------- XY chart'ai (bar / line / area) ----------

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 6,
  fontSize: 12,
};

function XyChartWidget({ widget }: { widget: AiWidget }): JSX.Element | null {
  const data = widget.data ?? [];
  const series = widget.series ?? [];
  const xKey = widget.xKey;
  if (data.length === 0 || series.length === 0 || !xKey) return null;

  const labelFor = (key: string): string => series.find((s) => s.key === key)?.label ?? key;
  const common = {
    data,
    margin: { top: 8, right: 8, left: 0, bottom: 0 },
  };
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
      <XAxis
        dataKey={xKey}
        tickFormatter={formatAxisLabel}
        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        tickFormatter={(v: number) => formatCompact(v, widget.format)}
        axisLine={false}
        tickLine={false}
        width={52}
      />
      <Tooltip
        contentStyle={TOOLTIP_STYLE}
        labelFormatter={(v) => formatAxisLabel(v)}
        formatter={(value, name) => [
          formatValue(typeof value === 'number' ? value : Number(value ?? 0), widget.format),
          labelFor(String(name ?? '')),
        ]}
      />
      {series.length > 1 ? (
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value: string) => labelFor(value)}
        />
      ) : null}
    </>
  );

  return (
    <ResponsiveContainer width="100%" height={260}>
      {widget.type === 'bar' ? (
        <BarChart {...common}>
          {axes}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={seriesColor(s.color, i)}
              radius={[3, 3, 0, 0]}
              stackId={widget.stacked ? 'stack' : undefined}
            />
          ))}
        </BarChart>
      ) : widget.type === 'line' ? (
        <LineChart {...common}>
          {axes}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={seriesColor(s.color, i)}
              strokeWidth={2}
              dot={data.length <= 24}
            />
          ))}
        </LineChart>
      ) : (
        <AreaChart {...common}>
          {axes}
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={seriesColor(s.color, i)}
              fill={seriesColor(s.color, i)}
              fillOpacity={0.18}
              strokeWidth={2}
              stackId={widget.stacked ? 'stack' : undefined}
            />
          ))}
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}

/** Y ašiai — kompaktiškas formatas (1,2 mln. €; 450 tūkst.). */
function formatCompact(value: number, format?: AiValueFormat): string {
  if (!Number.isFinite(value)) return '';
  const suffix = format === 'eur' ? ' €' : format === 'percent' ? '%' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString('lt-LT', { maximumFractionDigits: 1 })} mln.${suffix}`;
  if (abs >= 10_000)
    return `${(value / 1_000).toLocaleString('lt-LT', { maximumFractionDigits: 0 })} tūkst.${suffix}`;
  return `${value.toLocaleString('lt-LT')}${suffix}`;
}

// ---------- Pie ----------

function PieWidget({ widget }: { widget: AiWidget }): JSX.Element | null {
  const data = (widget.data ?? []).filter(
    (d): d is { name: string; value: number } =>
      typeof d.name === 'string' && typeof d.value === 'number',
  );
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="45%"
          outerRadius="78%"
          paddingAngle={2}
          strokeWidth={1}
        >
          {data.map((entry, i) => (
            <Cell key={`${entry.name}-${i}`} fill={AI_PALETTE[i % AI_PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name) => [
            formatValue(typeof value === 'number' ? value : Number(value ?? 0), widget.format),
            String(name ?? ''),
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value: string) => (value.length > 28 ? `${value.slice(0, 27)}…` : value)}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ---------- Table ----------

function TableWidget({ widget }: { widget: AiWidget }): JSX.Element | null {
  const columns = widget.columns ?? [];
  const rows = widget.rows ?? [];
  if (columns.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'px-3 py-2 font-medium',
                  c.align === 'right'
                    ? 'text-right'
                    : c.align === 'center'
                      ? 'text-center'
                      : 'text-left',
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">
                Nėra duomenų
              </td>
            </tr>
          ) : (
            rows.map((row, ri) => (
              <tr key={ri} className="border-b last:border-0 hover:bg-muted/40">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-3 py-2',
                      (c.format === 'eur' || c.format === 'number' || c.format === 'percent') &&
                        'tabular-nums',
                      c.align === 'right'
                        ? 'text-right'
                        : c.align === 'center'
                          ? 'text-center'
                          : 'text-left',
                    )}
                  >
                    {formatValue(row[c.key], c.format)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Progress ----------

function ProgressWidget({ widget }: { widget: AiWidget }): JSX.Element | null {
  const items = widget.items ?? [];
  if (items.length === 0) return null;
  return (
    <div className="space-y-3 p-1">
      {items.map((item, idx) => {
        const percent = item.max > 0 ? (item.value / item.max) * 100 : 0;
        const clamped = Math.min(percent, 100);
        const barColor =
          percent >= 100 ? 'bg-rose-600' : percent >= 80 ? 'bg-amber-500' : 'bg-teal-700';
        return (
          <div key={`${item.label}-${idx}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium">{item.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatValue(item.value, item.format)} / {formatValue(item.max, item.format)} (
                {Math.round(percent)}%)
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-all duration-500', barColor)}
                style={{ width: `${clamped}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Markdown (mini poaibis) ----------

function renderInline(text: string): React.ReactNode[] {
  // **bold** poaibis — be nested formatavimo.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

function MarkdownWidget({ widget }: { widget: AiWidget }): JSX.Element | null {
  const content = widget.content;
  if (!content) return null;
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  const flushList = (key: number): void => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} className="ml-4 list-disc space-y-1">
        {listBuffer.map((li, i) => (
          <li key={i}>{renderInline(li)}</li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };
  content.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listBuffer.push(trimmed.slice(2));
      return;
    }
    flushList(i);
    if (!trimmed) return;
    if (trimmed.startsWith('##')) {
      blocks.push(
        <h4 key={i} className="font-semibold">
          {renderInline(trimmed.replace(/^#+\s*/, ''))}
        </h4>,
      );
    } else {
      blocks.push(<p key={i}>{renderInline(trimmed)}</p>);
    }
  });
  flushList(-1);
  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}

// ---------- Radar ----------

function RadarWidget({ widget }: { widget: AiWidget }): JSX.Element | null {
  const data = widget.data ?? [];
  const series = widget.series ?? [];
  const xKey = widget.xKey;
  if (data.length === 0 || series.length === 0 || !xKey) return null;
  const labelFor = (key: string): string => series.find((s) => s.key === key)?.label ?? key;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        />
        <PolarRadiusAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
        {series.map((s, i) => (
          <Radar
            key={s.key}
            name={labelFor(s.key)}
            dataKey={s.key}
            stroke={seriesColor(s.color, i)}
            fill={seriesColor(s.color, i)}
            fillOpacity={0.3}
          />
        ))}
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name) => [
            formatValue(typeof value === 'number' ? value : Number(value ?? 0), widget.format),
            String(name ?? ''),
          ]}
        />
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ---------- Sankey ----------

type SankeyNodeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: { name?: string };
};

function SankeyNodeShape(props: SankeyNodeProps): JSX.Element {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, payload } = props;
  const color = AI_PALETTE[index % AI_PALETTE.length] ?? '#0f766e';
  const isRight = x > 320;
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 1)} fill={color} rx={2} />
      {height > 10 ? (
        <text
          x={isRight ? x - 6 : x + width + 6}
          y={y + height / 2}
          textAnchor={isRight ? 'end' : 'start'}
          dominantBaseline="middle"
          fontSize={11}
          fill="hsl(var(--foreground))"
        >
          {(payload?.name ?? '').length > 22
            ? `${(payload?.name ?? '').slice(0, 21)}…`
            : payload?.name}
        </text>
      ) : null}
    </g>
  );
}

function SankeyWidget({ widget }: { widget: AiWidget }): JSX.Element | null {
  const nodes = widget.nodes ?? [];
  const links = widget.links ?? [];
  if (nodes.length < 2 || links.length === 0) return null;
  // recharts Sankey reikalauja {nodes, links} su numeric source/target.
  const data = { nodes: nodes.map((n) => ({ name: n.name })), links };
  return (
    <ResponsiveContainer width="100%" height={Math.max(280, Math.min(nodes.length * 26, 460))}>
      <Sankey
        data={data}
        nodePadding={26}
        nodeWidth={12}
        linkCurvature={0.5}
        iterations={64}
        margin={{ top: 10, right: 150, bottom: 10, left: 10 }}
        node={(p: SankeyNodeProps) => <SankeyNodeShape {...p} />}
        link={{ stroke: '#0f766e', strokeOpacity: 0.22 }}
      >
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) =>
            formatValue(
              typeof value === 'number' ? value : Number(value ?? 0),
              widget.format ?? 'eur',
            )
          }
        />
      </Sankey>
    </ResponsiveContainer>
  );
}

// ---------- Treemap ----------

type TreemapContentProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  depth?: number;
  index?: number;
  name?: string;
  color?: string;
  value?: number;
  root?: { children?: unknown[] };
};

function TreemapContent(props: TreemapContentProps): JSX.Element | null {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    depth = 0,
    index = 0,
    name = '',
    color,
    value,
  } = props;
  if (width <= 0 || height <= 0) return null;
  // depth 1 = šaltinis (grupė), depth 2 = eilutė (langelis).
  const fill =
    depth === 1 ? 'transparent' : (color ?? AI_PALETTE[index % AI_PALETTE.length] ?? '#0f766e');
  const showLabel = depth >= 2 && width > 54 && height > 28;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="hsl(var(--card))"
        strokeWidth={depth === 1 ? 2 : 1}
        rx={2}
      />
      {showLabel ? (
        <>
          <text x={x + 6} y={y + 16} fontSize={11} fontWeight={600} fill="#fff">
            {name.length > Math.floor(width / 7)
              ? `${name.slice(0, Math.floor(width / 7))}…`
              : name}
          </text>
          {height > 42 && typeof value === 'number' ? (
            <text x={x + 6} y={y + 31} fontSize={10} fill="rgba(255,255,255,0.85)">
              {formatValue(value, 'eur')}
            </text>
          ) : null}
        </>
      ) : null}
    </g>
  );
}

function TreemapWidget({ widget }: { widget: AiWidget }): JSX.Element | null {
  const treemap = widget.treemap ?? [];
  if (treemap.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <Treemap
        data={treemap as unknown as React.ComponentProps<typeof Treemap>['data']}
        dataKey="value"
        nameKey="name"
        aspectRatio={1.4}
        isAnimationActive={false}
        content={<TreemapContent />}
      >
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) =>
            formatValue(typeof value === 'number' ? value : Number(value ?? 0), 'eur')
          }
        />
      </Treemap>
    </ResponsiveContainer>
  );
}

// ---------- Bendras renderer'is ----------

const SPAN_CLASSES: Record<number, string> = {
  1: 'sm:col-span-1 lg:col-span-1',
  2: 'sm:col-span-2 lg:col-span-2',
  3: 'sm:col-span-2 lg:col-span-3',
  4: 'sm:col-span-2 lg:col-span-4',
};

/** Ar widget'as turi minimalius laukus, kad jį būtų prasminga piešti. */
function isRenderableWidget(widget: AiWidget): boolean {
  switch (widget.type) {
    case 'stat':
      return widget.value !== undefined;
    case 'bar':
    case 'line':
    case 'area':
    case 'radar':
      return Boolean(widget.data?.length && widget.series?.length && widget.xKey);
    case 'pie':
      return Boolean(widget.data?.length);
    case 'table':
      return Boolean(widget.columns?.length);
    case 'progress':
      return Boolean(widget.items?.length);
    case 'markdown':
      return Boolean(widget.content);
    case 'sankey':
      return Boolean(widget.nodes?.length && widget.links?.length);
    case 'treemap':
      return Boolean(widget.treemap?.length);
    default:
      return false;
  }
}

export function WidgetRenderer({
  widget,
  style,
}: {
  widget: AiWidget;
  style?: React.CSSProperties;
}): JSX.Element | null {
  if (!isRenderableWidget(widget)) return null;

  const defaultSpan = widget.type === 'stat' ? 1 : 2;
  const span = widget.span ?? defaultSpan;

  let body: JSX.Element | null;
  switch (widget.type) {
    case 'stat':
      body = <StatWidget widget={widget} />;
      break;
    case 'bar':
    case 'line':
    case 'area':
      body = <XyChartWidget widget={widget} />;
      break;
    case 'radar':
      body = <RadarWidget widget={widget} />;
      break;
    case 'pie':
      body = <PieWidget widget={widget} />;
      break;
    case 'table':
      body = <TableWidget widget={widget} />;
      break;
    case 'progress':
      body = <ProgressWidget widget={widget} />;
      break;
    case 'markdown':
      body = <MarkdownWidget widget={widget} />;
      break;
    case 'sankey':
      body = <SankeyWidget widget={widget} />;
      break;
    case 'treemap':
      body = <TreemapWidget widget={widget} />;
      break;
    default:
      body = null;
  }
  if (body === null) return null;

  const showHeader = widget.type !== 'stat' && (widget.title || widget.subtitle);

  return (
    <Card
      data-testid={`ai-widget-${widget.id}`}
      style={style}
      className={cn(
        'col-span-1 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both',
        SPAN_CLASSES[span] ?? 'sm:col-span-2 lg:col-span-2',
      )}
    >
      {showHeader ? (
        <div className="border-b px-4 py-3">
          {widget.title ? <div className="text-sm font-semibold">{widget.title}</div> : null}
          {widget.subtitle ? (
            <div className="text-xs text-muted-foreground">{widget.subtitle}</div>
          ) : null}
        </div>
      ) : null}
      <CardContent
        className={cn('p-0', widget.type === 'stat' ? '' : 'p-4', widget.type === 'table' && 'p-0')}
      >
        {body}
      </CardContent>
    </Card>
  );
}
