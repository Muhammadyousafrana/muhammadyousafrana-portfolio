import { CredentialHighlights } from '@/components/CredentialHighlights'
import { ExperienceFeed } from '@/components/ExperienceFeed'
import { FitAssessment } from '@/components/FitAssessment'
import { Header } from '@/components/Header'
import { ResumeChat } from '@/components/ResumeChat'
import { SkillsMatrix } from '@/components/SkillsMatrix'
import { Button } from '@/components/ui/button'
import { resumeViewModel } from '@/data/resume'
import { motion, useReducedMotion } from 'framer-motion'
import { Bot, Briefcase, CheckCircle2, Cpu, Linkedin, Mail, MapPin, Target } from 'lucide-react'

export function HomePage() {
  const prefersReducedMotion = useReducedMotion()
  const { contact, homepage, firstName } = resumeViewModel
  const hasProofPoints = homepage.proofPoints.length > 0
  const hasExperience = resumeViewModel.experience.length > 0
  const spotlightCardSurfaceClassName =
    'bg-gradient-to-br from-slate-900 to-blue-900 dark:from-slate-950 dark:to-blue-950 text-white relative overflow-hidden shadow-2xl'
  const spotlightPrimaryGlowClassName =
    'absolute top-0 right-0 w-80 h-80 bg-blue-600/20 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2'
  const spotlightSecondaryGlowClassName =
    'absolute bottom-0 left-0 w-64 h-64 bg-indigo-600/10 blur-[80px] rounded-full -translate-x-1/2 translate-y-1/2'

  return (
    <div className="min-h-screen bg-background selection:bg-blue-100 dark:selection:bg-blue-900">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="py-8 md:py-12 lg:py-0 lg:min-h-[calc(100svh-4rem)] lg:flex lg:items-center mb-8 md:mb-10 lg:mb-0">
          <section
            id="hero-fold"
            className={`w-full grid gap-8 md:gap-10 lg:gap-8 lg:items-center ${
              hasProofPoints ? 'lg:grid-cols-[1.15fr_0.85fr]' : ''
            }`}
          >
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.6 }}
              className="space-y-7 md:space-y-8 lg:space-y-6 text-center lg:text-left lg:pr-4 xl:pr-6"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                <span className="meta-label text-blue-600 dark:text-blue-400">
                  {homepage.openToLabel}
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight max-w-4xl lg:mx-0 mx-auto leading-[0.95]">
                {homepage.heroHeadline}
              </h1>

              <p className="text-base md:text-lg text-muted-foreground max-w-2xl lg:mx-0 mx-auto leading-relaxed">
                {resumeViewModel.summary}
              </p>

              <div className="grid gap-3 grid-cols-1 min-[560px]:grid-cols-3 lg:max-w-[42rem]">
                <div className="min-w-0 rounded-xl border border-blue-100 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-900/10 p-3">
                  <p className="meta-label text-blue-700 dark:text-blue-300">Role Focus</p>
                  <p className="text-sm mt-1 font-medium leading-snug">{homepage.roleFocus}</p>
                </div>
                <div className="min-w-0 rounded-xl border border-blue-100 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-900/10 p-3">
                  <p className="meta-label text-blue-700 dark:text-blue-300">Location</p>
                  <p className="text-sm mt-1 font-medium inline-flex items-center gap-1.5 leading-snug">
                    <MapPin className="w-3.5 h-3.5 text-blue-600" />
                    <span className="min-w-0 break-words">{contact.location}</span>
                  </p>
                </div>
                <div className="min-w-0 rounded-xl border border-blue-100 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-900/10 p-3">
                  <p className="meta-label text-blue-700 dark:text-blue-300">Education</p>
                  <p className="text-sm mt-1 font-medium leading-snug">
                    {resumeViewModel.education.degree}
                  </p>
                </div>
              </div>

              <div
                className={`grid grid-cols-1 gap-2.5 pt-3 md:pt-4 lg:pt-1 max-w-[42rem] mx-auto lg:mx-0 ${
                  hasExperience ? 'md:grid-cols-3' : 'md:grid-cols-2'
                }`}
              >
                <Button
                  asChild
                  size="lg"
                  className="w-full rounded-full px-6 h-12 btn-gradient shadow-xl hover:shadow-blue-500/25 text-sm font-semibold !text-white hover:!text-white"
                >
                  <a href={`mailto:${contact.email}`}>
                    <Mail className="w-4 h-4 mr-2" />
                    Email {firstName} Directly
                  </a>
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="w-full rounded-full px-5 h-12 text-sm font-medium"
                >
                  <a href="#fit-check">
                    <Target className="w-4 h-4 mr-2" />
                    Run JD Fit Check
                  </a>
                </Button>
                {hasExperience && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="w-full rounded-full px-5 h-12 text-sm font-medium"
                  >
                    <a href="#experience">
                      <Briefcase className="w-4 h-4 mr-2" />
                      Review Experience
                    </a>
                  </Button>
                )}
              </div>
            </motion.div>

            {hasProofPoints && (
              <motion.aside
                initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: prefersReducedMotion ? 0 : 0.7,
                  delay: prefersReducedMotion ? 0 : 0.15,
                }}
                className={`${spotlightCardSurfaceClassName} rounded-3xl border border-slate-300/50 dark:border-slate-800 p-5 md:p-6`}
                aria-label="Recruiter proof points"
              >
                <div className={spotlightPrimaryGlowClassName} />
                <div className={spotlightSecondaryGlowClassName} />
                <div className="relative z-10 space-y-4">
                  <h2 className="text-xl md:text-2xl font-bold tracking-tight">At a glance</h2>
                  <ul className="space-y-3.5">
                    {homepage.proofPoints.map((proof) => (
                      <li
                        key={proof.sourceId}
                        className="rounded-xl border border-white/15 bg-white/5 p-3 md:p-4"
                      >
                        <p className="font-semibold text-sm inline-flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-blue-400" />
                          {proof.title}
                        </p>
                        <p className="text-xs md:text-sm text-blue-100/90 mt-2 leading-relaxed">
                          {proof.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.aside>
            )}
          </section>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="space-y-20 md:space-y-24">
            <ExperienceFeed />
            <CredentialHighlights />
            <SkillsMatrix />
            <FitAssessment />
          </div>

          <section className="py-20 md:py-24">
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
              whileInView={prefersReducedMotion ? undefined : { opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className={`${spotlightCardSurfaceClassName} rounded-[2.5rem] p-8 md:p-12 text-center space-y-9`}
            >
              <div className={spotlightPrimaryGlowClassName} />
              <div className={spotlightSecondaryGlowClassName} />
              <div className="relative z-10 space-y-6">
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
                  {homepage.ctaHeadline}
                </h2>
                <p className="text-blue-200/80 max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
                  {homepage.ctaSubtext}
                </p>
                <div className="flex flex-col sm:flex-row justify-center gap-3 pt-4">
                  <Button
                    asChild
                    size="lg"
                    className="w-full sm:w-auto bg-white text-blue-950 hover:bg-blue-100 hover:text-blue-900 hover:shadow-lg hover:shadow-blue-950/20 rounded-full px-10 h-14 text-base font-semibold transition-all"
                  >
                    <a href={`mailto:${contact.email}`}>
                      <Mail className="w-5 h-5 mr-2" />
                      Email {firstName}
                    </a>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="ghost"
                    className="w-full sm:w-auto text-white hover:text-white hover:bg-white/10 rounded-full h-14 px-8 border border-white/20 text-base font-semibold"
                  >
                    <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer">
                      <Linkedin className="w-5 h-5 mr-2" />
                      Open LinkedIn
                    </a>
                  </Button>
                </div>
              </div>
            </motion.div>
          </section>
        </div>
      </main>

      <footer className="py-12 border-t bg-slate-50/50 dark:bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col items-center md:items-start gap-2">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} {resumeViewModel.name}.
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              Built with <Cpu className="w-2.5 h-2.5" /> Cloudflare Workers & React
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background px-4 py-2 rounded-full border shadow-sm">
            <Bot className="w-3.5 h-3.5 text-blue-600" />
            <span>AI Usage Note: Requests are subject to server limits</span>
          </div>
        </div>
      </footer>
      <ResumeChat />
    </div>
  )
}
