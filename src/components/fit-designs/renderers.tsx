import {
  getFitPresentation,
  type FitAssessmentPresentation,
} from '@/components/fit-assessment-sections'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type FitAssessmentResult, type FitConfidence } from '@shared/fit-analysis'
import { AlertTriangle, CheckCircle, CircleDashed } from 'lucide-react'
import type { ReactNode } from 'react'

type DisplayFitConfidence = FitConfidence | 'Unknown'
type SnapshotTone = 'strong' | 'partial' | 'not-fit' | 'neutral'

interface ToneClasses {
  card: string
  header: string
  iconSurface: string
  scoreFill: string
}

interface ReportSectionDescriptor {
  title: string
  items: string[]
  emptyState?: string
}

interface FitResponsePreviewProps {
  result: FitAssessmentResult
}

const getToneClasses = (tone: SnapshotTone): ToneClasses => {
  if (tone === 'strong') {
    return {
      card: 'border-emerald-500/30 bg-emerald-50/10 dark:bg-emerald-900/10 glass',
      header: 'bg-emerald-50/60 dark:bg-emerald-900/20',
      iconSurface: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
      scoreFill: 'bg-emerald-500',
    }
  }

  if (tone === 'partial') {
    return {
      card: 'border-amber-500/30 bg-amber-50/10 dark:bg-amber-900/10 glass',
      header: 'bg-amber-50/60 dark:bg-amber-900/20',
      iconSurface: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
      scoreFill: 'bg-amber-500',
    }
  }

  if (tone === 'not-fit') {
    return {
      card: 'border-rose-500/30 bg-rose-50/10 dark:bg-rose-900/10 glass',
      header: 'bg-rose-50/60 dark:bg-rose-900/20',
      iconSurface: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
      scoreFill: 'bg-rose-500',
    }
  }

  return {
    card: 'border-blue-600/20 bg-blue-50/5 dark:bg-blue-900/5 glass-darker',
    header: 'bg-blue-50/50 dark:bg-blue-900/20',
    iconSurface: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
    scoreFill: 'bg-blue-500',
  }
}

const getReportConfidencePillClass = (confidence: DisplayFitConfidence): string => {
  if (confidence === 'High') return 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
  if (confidence === 'Medium')
    return 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
  if (confidence === 'Low')
    return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300'
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
}

const getConfidenceCopy = (confidence: DisplayFitConfidence): string => {
  if (confidence === 'High') {
    return 'The job requirements and documented resume evidence support a low-ambiguity call.'
  }

  if (confidence === 'Medium') {
    return 'The core signal is useful, but some requirements would still need interview validation.'
  }

  if (confidence === 'Low') {
    return 'The job post or the documented evidence is incomplete enough that the call could shift with more detail.'
  }

  return 'Confidence is unavailable for this payload.'
}

const getScoreContext = (presentation: FitAssessmentPresentation): string => {
  if (presentation.band === 'strong') {
    return 'Documented overlap is strong enough that the remaining risk is mostly interview validation, not baseline qualification.'
  }

  if (presentation.band === 'promising') {
    return 'There is real role overlap here, but the missing requirements still need direct validation before moving confidently.'
  }

  if (presentation.band === 'stretch') {
    return 'Some evidence transfers, but the documented gaps are material enough that this would be a deliberate stretch hire.'
  }

  return 'The transferable signal is limited because documented blockers outweigh the role overlap for this specific job.'
}

const getEvidenceSummary = (result: FitAssessmentResult): string =>
  `${result.matches.length} match${result.matches.length === 1 ? '' : 'es'}, ${result.keyGaps.length} gap${result.keyGaps.length === 1 ? '' : 's'}, ${result.disqualifiers.length} disqualifier${result.disqualifiers.length === 1 ? '' : 's'}, ${result.transferableStrengths.length} transferable strength${result.transferableStrengths.length === 1 ? '' : 's'}.`

const getReportSections = (result: FitAssessmentResult): ReportSectionDescriptor[] =>
  getFitPresentation(result).sections.map((section) => ({
    title: section.title,
    items: section.items,
  }))

const VerdictIcon = ({ tone, className }: { tone: SnapshotTone; className?: string }) => {
  if (tone === 'partial') {
    return <CircleDashed className={className} aria-hidden="true" />
  }

  if (tone === 'not-fit') {
    return <AlertTriangle className={className} aria-hidden="true" />
  }

  return <CheckCircle className={className} aria-hidden="true" />
}

const ReportMetrics = ({ result }: { result: FitAssessmentResult }) => {
  const scoreFill = getToneClasses(getFitPresentation(result).tone).scoreFill
  const clampedScore = Math.max(0, Math.min(100, result.fitScore))

  return (
    <section className="space-y-5 border-t border-border/70 pt-6">
      <dl className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <dt className="meta-label">Role Overlap</dt>
          <dd className="text-xl font-semibold tracking-tight">
            {result.fitScore}
            <span className="text-base font-medium text-muted-foreground">/100</span>
          </dd>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${scoreFill}`}
              style={{ width: `${clampedScore}%` }}
            />
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {getScoreContext(getFitPresentation(result))}
          </p>
        </div>

        <div className="space-y-2">
          <dt className="meta-label">Assessment Confidence</dt>
          <dd>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getReportConfidencePillClass(result.confidence)}`}
            >
              {result.confidence}
            </span>
          </dd>
          <p className="text-sm leading-6 text-muted-foreground">
            {getConfidenceCopy(result.confidence)}
          </p>
        </div>
      </dl>

      <p className="text-sm leading-6 text-muted-foreground">{getEvidenceSummary(result)}</p>
    </section>
  )
}

const ReportSectionStack = ({
  sections,
  className,
}: {
  sections: ReportSectionDescriptor[]
  className?: string
}) => (
  <div className={cn('space-y-6', className)}>
    {sections.map((section, index) => (
      <section
        key={section.title}
        className={cn(index > 0 && 'border-t border-border/70 pt-6')}
        aria-label={section.title}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold tracking-tight">{section.title}</h3>
          <span className="rounded-full border border-border/80 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {section.items.length}
          </span>
        </div>

        {section.items.length > 0 ? (
          <ul className="mt-3 space-y-2 pl-5 text-sm leading-6 text-muted-foreground list-disc">
            {section.items.map((item, itemIndex) => (
              <li key={`${section.title}-${itemIndex}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {section.emptyState ?? 'No supporting evidence is documented.'}
          </p>
        )}
      </section>
    ))}
  </div>
)

const ReportFrame = ({
  result,
  eyebrow,
  children,
}: {
  result: FitAssessmentResult
  eyebrow: string
  children: ReactNode
}) => {
  const presentation = getFitPresentation(result)
  const tone = presentation.tone
  const toneClasses = getToneClasses(tone)

  return (
    <Card className={cn('overflow-hidden border-2 shadow-xl', toneClasses.card)}>
      <CardHeader
        className={cn('space-y-5 border-b border-border/70 p-6 md:p-8', toneClasses.header)}
      >
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl',
              toneClasses.iconSurface
            )}
          >
            <VerdictIcon tone={tone} className="w-5 h-5" />
          </div>

          <div className="min-w-0 space-y-3">
            <p className="meta-label">{eyebrow}</p>
            <CardTitle className="text-2xl font-black tracking-tight md:text-3xl">
              {presentation.headline}
            </CardTitle>
            <p className="max-w-3xl text-sm leading-7 text-foreground/90 md:text-base">
              {result.summary}
            </p>
            <p className="max-w-3xl text-sm leading-6 text-foreground/85">
              <span className="font-semibold text-foreground">
                {presentation.recommendationLabel}:
              </span>{' '}
              {result.recommendation}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 p-6 md:p-8">{children}</CardContent>
    </Card>
  )
}

export function CleanReportFitResponsePreview({ result }: FitResponsePreviewProps) {
  return (
    <ReportFrame result={result} eyebrow={getFitPresentation(result).eyebrow}>
      <ReportMetrics result={result} />
      <ReportSectionStack sections={getReportSections(result)} />
    </ReportFrame>
  )
}
