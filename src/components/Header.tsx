import { EmailButton } from '@/components/EmailButton'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { RESUME_PDF_PATH, resumeViewModel } from '@/data/resume'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, Linkedin, Menu, X } from 'lucide-react'
import { useState } from 'react'

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const {
    contact,
    headerLabel,
    firstName,
    experience,
    projects,
    leadership,
    certifications,
    awards,
    skills,
  } = resumeViewModel

  const hasExperience = experience.length > 0
  const hasProjects = projects.length > 0
  const hasCredentials = leadership.length > 0 || certifications.length > 0 || awards.length > 0
  const hasSkills =
    skills.coreStrengths.length > 0 ||
    skills.appliedAndDeveloping.length > 0 ||
    skills.currentLearningFocus.length > 0

  const navLinks = [
    ...(hasExperience ? [{ href: '#experience', label: 'Experience' }] : []),
    ...(hasProjects ? [{ href: '#projects', label: 'Projects' }] : []),
    ...(hasCredentials ? [{ href: '#credentials', label: 'Credentials' }] : []),
    ...(hasSkills ? [{ href: '#skills', label: 'Skills' }] : []),
    { href: '#fit-check', label: 'Fit Check' },
  ]

  const handleLinkClick = () => {
    setMobileMenuOpen(false)
  }

  return (
    <header className="sticky top-0 w-full z-40 border-b glass">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-3">
          {/* Logo & Identity */}
          <a
            href="#"
            className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-90"
            aria-label="Home"
          >
            <img
              src="/icon.svg"
              alt="Muhammad Yousaf Rana Portfolio"
              className="size-10 shrink-0 rounded-xl shadow-sm"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-base sm:text-lg tracking-tight truncate block">
                  {resumeViewModel.name}
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Available
                </span>
              </div>
              <p className="meta-label text-blue-600 dark:text-blue-400 -mt-0.5 truncate">
                {headerLabel}
              </p>
            </div>
          </a>

          {/* Desktop Navigation */}
          <nav
            className="hidden lg:flex items-center gap-1 xl:gap-2 flex-none px-3 py-1.5 rounded-full border border-slate-200/80 dark:border-white/10 bg-slate-100/50 dark:bg-slate-900/50 backdrop-blur-md"
            aria-label="Primary"
          >
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1 text-sm font-medium text-slate-700 dark:text-slate-300 transition-all hover:bg-white dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 hover:shadow-sm"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Action Tools & Theme & Mobile Hamburger */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            {RESUME_PDF_PATH && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="hidden sm:inline-flex shrink-0 rounded-full h-9 px-3.5 text-xs font-semibold whitespace-nowrap border-slate-200 dark:border-slate-800 hover:border-blue-400 transition-colors"
              >
                <a
                  href={RESUME_PDF_PATH}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open resume PDF"
                  title="Open resume PDF"
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5 text-blue-600 dark:text-blue-400" />
                  <span>Resume PDF</span>
                </a>
              </Button>
            )}

            <div className="flex shrink-0 items-center gap-0.5 border-r pr-1.5 sm:pr-2.5">
              <Button asChild variant="ghost" size="icon" className="size-9 rounded-full">
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open LinkedIn profile"
                  title="LinkedIn"
                >
                  <Linkedin className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                </a>
              </Button>
              <EmailButton
                email={contact.email}
                label={`Email ${firstName}`}
                iconOnly
                variant="ghost"
                size="icon"
                className="size-9 rounded-full"
              />
            </div>

            <ThemeToggle className="relative top-0 right-0 shrink-0" />

            {/* Mobile Menu Toggle Button */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden size-9 rounded-full"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
            >
              {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Animated Dropdown Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            id="mobile-navigation"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden border-t bg-background/95 backdrop-blur-2xl px-4 py-5 shadow-2xl"
          >
            <nav className="flex flex-col space-y-1" aria-label="Mobile Navigation">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={handleLinkClick}
                  className="flex items-center px-4 py-3 rounded-xl text-base font-semibold text-foreground/90 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </nav>

            <div className="mt-4 pt-4 border-t border-slate-200/80 dark:border-slate-800 flex flex-col gap-2.5">
              {RESUME_PDF_PATH && (
                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-center rounded-xl h-11 text-sm font-medium"
                >
                  <a
                    href={RESUME_PDF_PATH}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleLinkClick}
                  >
                    <FileText className="w-4 h-4 mr-2 text-blue-600" />
                    Open Resume PDF
                  </a>
                </Button>
              )}
              <EmailButton
                email={contact.email}
                label={`Email ${firstName} Directly`}
                className="w-full justify-center rounded-xl h-11 text-sm font-semibold btn-gradient"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
