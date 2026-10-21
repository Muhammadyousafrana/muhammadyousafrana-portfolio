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
import { AlertTriangle, FileText, Loader2, RefreshCw, Target } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const FIT_RESULT_SCROLL_TOP_OFFSET_PX = 96
const FIT_RESULT_SCROLL_FOCUS_THRESHOLD_RATIO = 0.45

const ANALYSIS_STAGES = [
  'Preparing the posting',
  'Checking must-have requirements',
  'Mapping resume evidence',
  'Weighing gaps and disqualifiers',
  'Forming an honest verdict',
] as const
const ANALYSIS_STAGE_INTERVAL_MS = 2500

const JD_PRESETS = [
  {
    label: 'Machine Learning Engineer',
    text: 'Looking for a Machine Learning Engineer to develop and deploy multimodal models across computer vision and audio signals. Requirements: Strong experience in PyTorch, Python, model optimization, sensor fusion, Docker containerization, and shipping models to production.',
  },
  {
    label: 'Edge AI Specialist',
    text: 'Seeking an Edge AI Engineer experienced in lightweight on-device inference. Must have hands-on experience with post-training INT8 quantization, LiteRT/TensorFlow Lite, embedded Linux/Android deployments, and optimizing neural network latency under 30ms on constrained hardware.',
  },
  {
    label: 'MLOps & Simulation',
    text: 'Hiring an MLOps Engineer to build automated training, evaluation, and simulation pipelines. Experience with robotics simulators (NVIDIA Isaac Sim / Isaac Lab), reinforcement learning, containerized environments, and CI/CD pipelines for autonomous drone systems required.',
  },
]

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
    <Card className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-3.5 px-6 bg-zinc-50 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-2.5">
          <Loader2
            className={cn(
              'w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400',
              !prefersReducedMotion && 'animate-spin'
            )}
            aria-hidden="true"
          />
          <CardTitle className="truncate text-sm sm:text-base font-semibold">
            Assessing Role Fit
          </CardTitle>
        </div>
        <div className="meta-label text-zinc-500 dark:text-zinc-400">Usually 5–15s</div>
      </CardHeader>
      <CardContent className="p-6 md:p-8 space-y-6">
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
                      'flex size-2 shrink-0 rounded-full transition-colors duration-300',
                      isActive
                        ? cn(
                            'bg-blue-600 dark:bg-blue-400',
                            !prefersReducedMotion && 'animate-pulse'
                          )
                        : isPast
                          ? 'bg-zinc-400 dark:bg-zinc-500'
                          : 'bg-zinc-200 dark:bg-zinc-800'
                    )}
                  />
                  <span
                    className={cn(
                      'text-sm transition-colors duration-300',
                      isActive
                        ? 'font-semibold text-foreground'
                        : isPast
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/50'
                    )}
                  >
                    {stage}
                  </span>
                </li>
              )
            })}
          </ol>
          <p className="text-sm leading-relaxed text-muted-foreground pt-1">
            Weighing your job description against documented resume evidence &mdash; matches, gaps,
            and honest disqualifiers included.
          </p>
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
    <section id="fit-check" className="scroll-mt-24 w-full" aria-labelledby="fit-check-title">
      <div className="space-y-8">
        {/* Section Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center border border-blue-200/80 dark:border-blue-900/60">
              <Target className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="fit-check-title"
                className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground"
              >
                Job Fit Assessment
              </h2>
              <p className="meta-label mt-0.5 text-zinc-500">Recruiter Evaluation Tool</p>
            </div>
          </div>
          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl pt-1">
            Paste a job description for an objective read on role overlap, verifiable technical
            evidence, and honest gap reporting.
          </p>
        </div>

        {/* Input Card */}
        <Card className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-zinc-50/70 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 py-4 px-5 sm:px-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <FileText className="w-4 h-4 text-zinc-500" aria-hidden="true" />
                Job Posting Input
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Include requirements & constraints
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="p-5 sm:p-6 space-y-5">
            {/* Presets Row */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Quick sample roles:</p>
              <div className="flex flex-wrap gap-2">
                {JD_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setJd(preset.text)}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100/80 dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Form */}
            <form onSubmit={handleAnalyze} className="space-y-5" aria-busy={isAnalyzing}>
              <div className="space-y-1.5">
                <label
                  htmlFor="fit-jd-input"
                  className="text-xs font-semibold text-foreground uppercase tracking-wider"
                >
                  Job Description Text
                </label>
                <Textarea
                  id="fit-jd-input"
                  placeholder="Paste the full job posting requirements here..."
                  className="min-h-[180px] font-sans text-sm resize-y rounded-lg border-zinc-200 dark:border-zinc-700 bg-background text-foreground focus:ring-1 focus:ring-blue-500"
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  aria-describedby="fit-jd-help"
                />
                <p id="fit-jd-help" className="text-xs text-muted-foreground">
                  Paste the responsibilities, must-haves, and qualifications for the role.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={isAnalyzing || !jd.trim()}
                  className="btn-gradient px-6 rounded-lg h-10 text-sm font-medium cursor-pointer"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2
                        className={cn('w-4 h-4 mr-2', !prefersReducedMotion && 'animate-spin')}
                      />
                      Analyzing Fit...
                    </>
                  ) : (
                    'Calculate Fit Score'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Results Panel */}
        <AnimatePresence mode="wait">
          {(isAnalyzing || result || analysisError) && (
            <motion.div
              key={isAnalyzing ? 'analyzing' : analysisError ? 'error' : 'result'}
              ref={fitResultRef}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
              className="scroll-mt-24 mt-8"
            >
              {isAnalyzing ? (
                <FitAnalyzingPanel />
              ) : analysisError ? (
                <Card className="rounded-xl border border-amber-500/30 bg-amber-50/10 dark:bg-amber-950/20 shadow-sm overflow-hidden">
                  <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-3.5 px-6 bg-amber-50/50 dark:bg-amber-950/30">
                    <div className="flex min-w-0 items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                      <CardTitle className="truncate text-sm sm:text-base font-semibold">
                        Analysis Failed
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6 space-y-4" role="alert" aria-live="polite">
                    <p className="text-sm font-medium">{analysisError.message}</p>
                    {analysisError.canRetry && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={retryAnalysis}
                        disabled={isAnalyzing || !jd.trim()}
                        className="rounded-lg w-fit text-xs font-medium"
                      >
                        {isAnalyzing ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
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
