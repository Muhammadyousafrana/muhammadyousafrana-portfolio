import {
  FALLBACK_FIT_ASSESSMENT_ERROR,
  getFitAssessmentErrorState,
  getFitAssessmentRequestErrorState,
  type FitAssessmentErrorState,
} from '@/components/fit-assessment-errors'
import { CleanReportFitResponsePreview } from '@/components/fit-designs/renderers'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useTurnstileChallenge } from '@/lib/turnstile'
import { cn } from '@/lib/utils'
import { fitAssessmentSuccessResponseSchema, type FitAssessmentResult } from '@shared/fit-analysis'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, Info, Loader2, RefreshCw, Search, Sparkles, Target } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const FIT_RESULT_SCROLL_TOP_OFFSET_PX = 96
const FIT_RESULT_SCROLL_FOCUS_THRESHOLD_RATIO = 0.45

// The assessment is a single model pass; these describe the passes it makes over
// the posting, not deterministic backend progress. The highlight advances on a
// timer to keep the wait legible without claiming to know real completion.
const ANALYSIS_STAGES = [
  'Preparing the posting',
  'Checking must-have requirements',
  'Mapping resume evidence',
  'Weighing gaps and disqualifiers',
  'Forming an honest verdict',
] as const
const ANALYSIS_STAGE_INTERVAL_MS = 2500

function FitAnalyzingPanel() {
  const prefersReducedMotion = useReducedMotion()
  const [stageIndex, setStageIndex] = useState(0)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStageIndex((current) => Math.min(current + 1, ANALYSIS_STAGES.length - 1))
    }, ANALYSIS_STAGE_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [])

  return (
    <Card className="border-2 overflow-hidden border-blue-600/20 bg-blue-50/5 dark:bg-blue-900/5 glass-darker">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-4 bg-blue-50/50 dark:bg-blue-900/20">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2
            className={cn(
              'w-5 h-5 shrink-0 text-blue-600',
              !prefersReducedMotion && 'animate-spin'
            )}
            aria-hidden="true"
          />
          <CardTitle className="truncate text-lg">Assessing fit</CardTitle>
        </div>
        <div className="meta-label shrink-0">Usually 5&ndash;15s</div>
      </CardHeader>
      <CardContent className="p-6 md:p-8 space-y-7">
        <div className="space-y-4">
          <p className="sr-only" role="status" aria-live="polite">
            {ANALYSIS_STAGES[stageIndex]}
          </p>
          <ol className="space-y-2.5" aria-hidden="true">
            {ANALYSIS_STAGES.map((stage, index) => {
              const isActive = index === stageIndex
              const isPast = index < stageIndex
              return (
                <li key={stage} className="flex items-center gap-3">
                  <span
                    className={cn(
                      'flex size-2.5 shrink-0 rounded-full transition-colors duration-500',
                      isActive
                        ? cn('bg-blue-500', !prefersReducedMotion && 'animate-pulse')
                        : isPast
                          ? 'bg-blue-400/70'
                          : 'bg-slate-300 dark:bg-slate-700'
                    )}
                  />
                  <span
                    className={cn(
                      'text-sm transition-colors duration-500',
                      isActive
                        ? 'font-semibold text-foreground'
                        : isPast
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/60'
                    )}
                  >
                    {stage}
                  </span>
                </li>
              )
            })}
          </ol>
          <p className="text-sm leading-6 text-muted-foreground">
            Weighing your job description against documented resume evidence &mdash; matches, gaps,
            and honest disqualifiers included.
          </p>
        </div>

        <div aria-hidden="true" className="space-y-6 border-t border-border/70 pt-6">
          <div className="grid gap-5 sm:grid-cols-2">
            {[0, 1].map((column) => (
              <div key={column} className="space-y-2.5">
                <div
                  className={cn(
                    'h-3 w-24 rounded-full bg-slate-200 dark:bg-slate-800',
                    !prefersReducedMotion && 'animate-pulse'
                  )}
                />
                <div
                  className={cn(
                    'h-2 w-full rounded-full bg-slate-200/70 dark:bg-slate-800/70',
                    !prefersReducedMotion && 'animate-pulse'
                  )}
                />
                <div
                  className={cn(
                    'h-2 w-4/5 rounded-full bg-slate-200/70 dark:bg-slate-800/70',
                    !prefersReducedMotion && 'animate-pulse'
                  )}
                />
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {['w-full', 'w-11/12', 'w-3/4'].map((width) => (
              <div
                key={width}
                className={cn(
                  'h-2.5 rounded-full bg-slate-200/70 dark:bg-slate-800/70',
                  width,
                  !prefersReducedMotion && 'animate-pulse'
                )}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function FitAssessment() {
  const { requestChallenge, reportChallengeRejected } = useTurnstileChallenge()
  const prefersReducedMotion = useReducedMotion()
  const [jd, setJd] = useState('')
  const [result, setResult] = useState<FitAssessmentResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<FitAssessmentErrorState | null>(null)
  const fitResultRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const fitResultElement = fitResultRef.current
    if (!fitResultElement || (!result && !analysisError && !isAnalyzing)) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const { top } = fitResultElement.getBoundingClientRect()
      const focusThreshold = Math.max(
        FIT_RESULT_SCROLL_TOP_OFFSET_PX,
        window.innerHeight * FIT_RESULT_SCROLL_FOCUS_THRESHOLD_RATIO
      )
      const isResultTopInFocusBand = top >= FIT_RESULT_SCROLL_TOP_OFFSET_PX && top <= focusThreshold

      if (!isResultTopInFocusBand) {
        fitResultElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [analysisError, isAnalyzing, result])

  const runAnalysis = async (jdInput: string) => {
    setIsAnalyzing(true)
    setResult(null)
    setAnalysisError(null)

    try {
      // The shared human check gates the request; the lease cookie then rides
      // the same-origin fetch, so no per-request token header is needed.
      const verified = await requestChallenge()
      if (!verified) {
        setAnalysisError({ message: 'Complete the human check and try again.', canRetry: true })
        return
      }

      const response = await fetch('/api/analyze-fit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jd: jdInput }),
      })

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        console.error('analyze-fit returned non-JSON payload')
        setAnalysisError(FALLBACK_FIT_ASSESSMENT_ERROR)
        return
      }

      if (!isRecord(payload) || typeof payload.success !== 'boolean') {
        console.error('analyze-fit returned invalid response shape', payload)
        setAnalysisError(FALLBACK_FIT_ASSESSMENT_ERROR)
        return
      }

      if (!response.ok || !payload.success) {
        console.error('analyze-fit request failed', {
          status: response.status,
          payload,
        })
        // A rejected lease (403) means the server wants a fresh human check.
        if (response.status === 403) {
          reportChallengeRejected()
        }
        setAnalysisError(getFitAssessmentErrorState(payload) ?? FALLBACK_FIT_ASSESSMENT_ERROR)
        return
      }

      const parsedPayload = fitAssessmentSuccessResponseSchema.safeParse(payload)
      if (!parsedPayload.success) {
        console.error('analyze-fit returned malformed data payload', {
          payload,
          issues: parsedPayload.error.issues,
        })
        setAnalysisError(FALLBACK_FIT_ASSESSMENT_ERROR)
        return
      }

      setResult(parsedPayload.data.data)
    } catch (error) {
      console.error('analyze-fit network/client error', error)
      setAnalysisError(getFitAssessmentRequestErrorState())
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!jd.trim() || isAnalyzing) return

    await runAnalysis(jd.trim())
  }

  const retryAnalysis = () => {
    if (!jd.trim() || isAnalyzing) return
    void runAnalysis(jd.trim())
  }

  return (
    <section id="fit-check" className="scroll-mt-24" aria-labelledby="fit-check-title">
      <div className="space-y-9">
        <div className="max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800">
            <Target className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
            <span className="meta-label text-blue-600 dark:text-blue-400">Recruiter Tool</span>
          </div>
          <h2 id="fit-check-title" className="text-3xl md:text-4xl font-bold tracking-tight">
            Job Fit Assessment
          </h2>
          <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
            Paste a job description for a direct read on strengths and any gaps or hard blockers
            &mdash; not just the positive matches.
          </p>
        </div>

        <Card className="border-2 border-slate-200 dark:border-slate-800 glass shadow-xl overflow-hidden">
          <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b space-y-3.5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 uppercase tracking-wider">
              <Search className="w-4 h-4" aria-hidden="true" />
              Job Description Input
            </CardTitle>
            <CardDescription className="text-xs md:text-sm inline-flex items-start gap-2 leading-relaxed">
              <Info
                className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0"
                aria-hidden="true"
              />
              Include required skills, years of experience, and domain constraints for a more useful
              assessment.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-5 md:p-6">
            <form onSubmit={handleAnalyze} className="space-y-6" aria-busy={isAnalyzing}>
              <div className="space-y-2">
                <label htmlFor="fit-jd-input" className="text-sm font-medium">
                  Job description
                </label>
                <Textarea
                  id="fit-jd-input"
                  placeholder="Example: We are hiring a Senior Software Engineer with strong backend, API design, and cloud infrastructure experience, plus a track record of shipping and owning production systems..."
                  className="min-h-[220px] font-sans text-sm resize-y bg-background/50"
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  aria-describedby="fit-jd-help"
                />
                <p id="fit-jd-help" className="text-xs text-muted-foreground">
                  Tip: paste the full posting including must-have and nice-to-have requirements.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={isAnalyzing || !jd.trim()}
                  className="btn-gradient px-8 rounded-full h-11 text-white hover:text-white dark:text-white dark:hover:text-white"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2
                        className={cn('w-4 h-4 mr-2', !prefersReducedMotion && 'animate-spin')}
                      />
                      Analyzing Fit...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Calculate Fit Score
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <AnimatePresence mode="wait">
          {(isAnalyzing || result || analysisError) && (
            <motion.div
              key={isAnalyzing ? 'analyzing' : analysisError ? 'error' : 'result'}
              ref={fitResultRef}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -20 }}
              className="scroll-mt-24 mt-12"
            >
              {isAnalyzing ? (
                <FitAnalyzingPanel />
              ) : analysisError ? (
                <Card className="border-2 overflow-hidden border-amber-500/30 bg-amber-50/5 dark:bg-amber-900/10 glass">
                  <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-4 bg-amber-50/60 dark:bg-amber-900/20">
                    <div className="flex min-w-0 items-center gap-2">
                      <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
                      <CardTitle className="truncate text-lg">Analysis Failed</CardTitle>
                    </div>
                    <div className="meta-label hidden shrink-0 sm:block">Attention Required</div>
                  </CardHeader>
                  <CardContent className="p-6 md:p-8 space-y-4" role="alert" aria-live="polite">
                    <p className="text-sm font-medium">{analysisError.message}</p>
                    {analysisError.canRetry && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={retryAnalysis}
                        disabled={isAnalyzing || !jd.trim()}
                        className="rounded-full w-fit text-sm"
                      >
                        {isAnalyzing ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-2" />
                        )}
                        Retry analysis
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div role="status" aria-live="polite">
                  {result && <CleanReportFitResponsePreview result={result} />}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
