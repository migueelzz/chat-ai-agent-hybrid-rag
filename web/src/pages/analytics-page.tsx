import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart2, TrendingUp, Clock } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { getMetricsCalls, getMetricsErrors, getMetricsSummary } from '@/lib/api'
import type { DailyCalls, ErrorLog, MetricsSummary } from '@/lib/types'

const PERIODS = [
  { label: 'Hoje', days: 1 },
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: 'Tudo', days: 365 },
] as const

const callsChartConfig = {
  calls: { label: 'Chamadas', color: 'var(--chart-1)' },
} satisfies ChartConfig

function formatDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-')
  return `${day}/${month}`
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  loading?: boolean
}

function StatCard({ icon, label, value, sub, loading }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        {icon}
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className="text-2xl font-semibold text-foreground">{value}</p>
      )}
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

export function AnalyticsPage() {
  const [days, setDays] = useState(7)
  const [calls, setCalls] = useState<DailyCalls[]>([])
  const [summary, setSummary] = useState<MetricsSummary | null>(null)
  const [errors, setErrors] = useState<ErrorLog[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [c, s, e] = await Promise.all([
      getMetricsCalls(days),
      getMetricsSummary(days),
      getMetricsErrors(50),
    ])
    setCalls(c)
    setSummary(s)
    setErrors(e)
    setLoading(false)
  }, [days])

  useEffect(() => { void load() }, [load])

  const chartData = calls.map((r) => ({ ...r, date: formatDate(r.date) }))
  const periodLabel = days === 365 ? 'todo o período' : `últimos ${days} dia${days > 1 ? 's' : ''}`

  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="size-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Analytics</h1>
          </div>

          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={[
                  'cursor-pointer px-3 py-1.5 transition-colors',
                  days === p.days
                    ? 'border text-white'
                    : 'text-muted-foreground hover:bg-muted',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            icon={<TrendingUp className="size-4" />}
            label="Chamadas ao LLM"
            loading={loading}
            value={String(summary?.total_calls ?? 0)}
            sub={periodLabel}
          />
          <StatCard
            icon={<Clock className="size-4" />}
            label="Latência média"
            loading={loading}
            value={summary ? `${summary.avg_latency_ms.toFixed(0)} ms` : '—'}
            sub={periodLabel}
          />
          <StatCard
            icon={<AlertTriangle className="size-4" />}
            label="Erros"
            loading={loading}
            value={String(summary?.error_count ?? 0)}
            sub={periodLabel}
          />
        </div>

        {/* Bar chart */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
          <p className="text-sm font-medium">Chamadas por dia</p>
          {loading ? (
            <div className="h-52 flex flex-col justify-end gap-2 px-2">
              <div className="flex items-end justify-around h-40 gap-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="flex-1 rounded-t"
                    style={{ height: `${30 + Math.sin(i) * 20 + (i % 3) * 15}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-around gap-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 flex-1" />
                ))}
              </div>
            </div>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sem dados no período selecionado.</p>
          ) : (
            <ChartContainer config={callsChartConfig} className="h-52 w-full">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="calls" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </div>

        {/* Error log */}
        <div className="rounded-xl border border-border bg-card flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-medium">Log de erros recentes</p>
          </div>
          {loading ? (
            <div className="flex flex-col divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-24 shrink-0" />
                  <Skeleton className="h-4 w-16 shrink-0" />
                  <Skeleton className="h-5 w-20 rounded-full shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : errors.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">Nenhum erro registrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-left">
                    <th className="px-4 py-2 font-medium whitespace-nowrap">Quando</th>
                    <th className="px-4 py-2 font-medium whitespace-nowrap">Sessão</th>
                    <th className="px-4 py-2 font-medium whitespace-nowrap">Tipo</th>
                    <th className="px-4 py-2 font-medium">Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(e.timestamp)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {e.session_id ? e.session_id.slice(0, 8) : '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {e.error_type ? (
                          <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs font-medium">
                            {e.error_type}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground max-w-sm truncate">
                        {e.error_message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
