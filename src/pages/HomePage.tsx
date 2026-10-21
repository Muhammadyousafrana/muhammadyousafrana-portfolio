import { CredentialHighlights } from '@/components/CredentialHighlights'
import { EmailButton } from '@/components/EmailButton'
import { ExperienceFeed } from '@/components/ExperienceFeed'
import { FitAssessment } from '@/components/FitAssessment'
import { Header } from '@/components/Header'
import { ProfileLinks } from '@/components/ProfileLinks'
import { ResumeChat } from '@/components/ResumeChat'
import { SkillsMatrix } from '@/components/SkillsMatrix'
import { Button } from '@/components/ui/button'
import { resumeViewModel } from '@/data/resume'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Briefcase,
  CheckCircle2,
  Cpu,
  GraduationCap,
  Layers,
  Linkedin,
  MapPin,
  Target,
} from 'lucide-react'

export function HomePage() {
  const prefersReducedMotion = useReducedMotion()
  const { contact, homepage, firstName } = resumeViewModel
  const hasProofPoints = homepage.proofPoints.length > 0
  const hasExperience = resumeViewModel.experience.length > 0

  return (
    <div className="min-h-screen bg-background selection:bg-blue-500/20 text-foreground">
      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* ============================================================== */}
        {/* HERO SECTION                                                    */}
        {/* ============================================================== */}
        <div className="py-14 sm:py-20 lg:py-24 border-b border-zinc-200 dark:border-zinc-800 mb-16">
          <section
            id="hero-fold"
            className={`w-full grid gap-12 lg:gap-12 lg:items-start ${
              hasProofPoints ? 'lg:grid-cols-[1.15fr_0.85fr]' : ''
            }`}
          >
            {/* Left Column: Mission Pitch */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.5 }}
              className="space-y-6 text-left"
            >
              {/* Status Chip */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {homepage.openToLabel}
                </span>
              </div>

              {/* Title & Headline */}
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2">
                  <span className="text-xs sm:text-sm font-semibold tracking-wide text-blue-600 dark:text-blue-400 uppercase">
                    {resumeViewModel.name} &bull; AI Engineer
                  </span>
                </div>
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground leading-[1.12]">
                  {homepage.heroHeadline}
                </h1>
                <p className="text-base sm:text-lg text-muted-foreground leading-relaxed font-normal pt-1">
                  {resumeViewModel.summary}
                </p>
              </div>

              {/* Quick Spec Pills */}
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 pt-1">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-3.5">
                  <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                    <Layers className="size-3.5" />
                    <p className="meta-label">Role Focus</p>
                  </div>
                  <p className="text-xs sm:text-sm mt-1 font-semibold text-foreground">
                    {homepage.roleFocus}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-3.5">
                  <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                    <MapPin className="size-3.5" />
                    <p className="meta-label">Location</p>
                  </div>
                  <p className="text-xs sm:text-sm mt-1 font-semibold text-foreground">
                    {contact.location}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-3.5">
                  <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                    <GraduationCap className="size-3.5" />
                    <p className="meta-label">Education</p>
                  </div>
                  <p className="text-xs sm:text-sm mt-1 font-semibold text-foreground">
                    {resumeViewModel.education.degree}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 pt-2">
                <EmailButton
                  email={contact.email}
                  label={`Email ${firstName} directly`}
                  size="default"
                  className="rounded-lg px-5 h-11 btn-gradient text-sm font-medium shadow-sm cursor-pointer"
                />
                <Button
                  asChild
                  size="default"
                  variant="outline"
                  className="rounded-lg px-4.5 h-11 text-sm font-medium border-zinc-200 dark:border-zinc-700 bg-background hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <a href="#fit-check">
                    <Target className="w-4 h-4 mr-2 text-zinc-500" />
                    Run JD Fit Check
                  </a>
                </Button>
                {hasExperience && (
                  <Button
                    asChild
                    size="default"
                    variant="ghost"
                    className="rounded-lg px-4.5 h-11 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    <a href="#experience">
                      <Briefcase className="w-4 h-4 mr-2" />
                      Review Experience
                    </a>
                  </Button>
                )}
              </div>
            </motion.div>

            {/* Right Column: Profile & Key Proof Points */}
            {hasProofPoints && (
              <motion.aside
                initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: prefersReducedMotion ? 0 : 0.6,
                  delay: prefersReducedMotion ? 0 : 0.1,
                }}
                className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-6 sm:p-7 shadow-xs space-y-6"
                aria-label="Candidate proof points"
              >
                {/* Profile Header */}
                <div className="flex items-center gap-4 border-b border-zinc-200/80 dark:border-zinc-800 pb-5">
                  <img
                    src="/profile.png"
                    alt="Portrait of Muhammad Yousaf Rana, AI Engineer"
                    className="size-16 rounded-full border border-zinc-200 dark:border-zinc-700 object-cover object-center shadow-xs"
                  />
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-foreground">
                      {resumeViewModel.name}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {resumeViewModel.experience[0]?.title ?? 'AI Engineer'} · {contact.location}
                    </p>
                  </div>
                </div>

                {/* Highlights */}
                <div className="space-y-4">
                  <p className="meta-label text-zinc-500 dark:text-zinc-400">At A Glance</p>
                  <ul className="space-y-3.5">
                    {homepage.proofPoints.map((proof) => (
                      <li
                        key={proof.sourceId}
                        className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/80 bg-white dark:bg-zinc-800/60 p-3.5 shadow-2xs"
                      >
                        <p className="font-semibold text-xs sm:text-sm inline-flex items-center gap-2 text-foreground">
                          <CheckCircle2 className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />
                          <span>{proof.title}</span>
                        </p>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                          {proof.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Technical Tags */}
                <div className="pt-2 flex flex-wrap gap-1.5">
                  {['LiteRT', 'INT8 Quantization', 'Isaac Sim', 'EfficientNetV2', 'GCC-PHAT'].map(
                    (tech) => (
                      <span key={tech} className="telemetry-tag text-[10px] py-0.5 px-2">
                        {tech}
                      </span>
                    )
                  )}
                </div>
              </motion.aside>
            )}
          </section>
        </div>

        {/* ============================================================== */}
        {/* BODY SECTIONS                                                  */}
        {/* ============================================================== */}
        <div className="space-y-24">
          <ExperienceFeed />
          <CredentialHighlights />
          <SkillsMatrix />
          <FitAssessment />

          {/* Bottom Call To Action */}
          <section className="py-16">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-8 sm:p-12 text-center space-y-6">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {homepage.ctaHeadline}
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
                {homepage.ctaSubtext}
              </p>
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <EmailButton
                  email={contact.email}
                  label={`Email ${firstName}`}
                  size="default"
                  className="rounded-lg px-6 h-11 btn-gradient text-sm font-medium cursor-pointer"
                />
                <Button
                  asChild
                  size="default"
                  variant="outline"
                  className="rounded-lg px-5 h-11 border-zinc-200 dark:border-zinc-700 bg-background text-sm font-medium"
                >
                  <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer">
                    <Linkedin className="w-4 h-4 mr-2 text-zinc-500" />
                    Open LinkedIn
                  </a>
                </Button>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* ============================================================== */}
      {/* FOOTER: With Extra Bottom Clearance so Floating FAB Never Overlaps */}
      {/* ============================================================== */}
      <footer className="pt-12 pb-28 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col items-center md:items-start gap-1">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} {resumeViewModel.name}.
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              Built with <Cpu className="w-3 h-3 text-zinc-400" /> Cloudflare Workers & React
            </p>
          </div>
          <div className="text-xs text-muted-foreground bg-background px-3.5 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800">
            <span>Requests subject to AI server limits</span>
          </div>
        </div>

        {/* Profile Links with Full Visibility & Clearance */}
        <ProfileLinks
          profiles={[{ label: 'LinkedIn', url: contact.linkedinUrl }, ...contact.profiles]}
        />
      </footer>

      {/* Compact Floating AI Twin Launcher */}
      <ResumeChat />
    </div>
  )
}
