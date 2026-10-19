import { EmailButton } from '@/components/EmailButton'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { RESUME_PDF_PATH, resumeViewModel } from '@/data/resume'
import { FileText, Linkedin } from 'lucide-react'

export function Header() {
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
  // Hide nav links whose target section hides for a sparse resume, so no link
  // scrolls to nothing. Mirrors the section-level emptiness checks in each block.
  const hasExperience = experience.length > 0
  const hasProjects = projects.length > 0
  const hasCredentials = leadership.length > 0 || certifications.length > 0 || awards.length > 0
  const hasSkills =
    skills.coreStrengths.length > 0 ||
    skills.appliedAndDeveloping.length > 0 ||
    skills.currentLearningFocus.length > 0

  return (
    <header className="sticky top-0 w-full z-40 border-b glass">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/icon.svg" alt="" className="size-10 shrink-0 rounded-xl" />
            <div className="min-w-0">
              <h1 className="font-bold text-lg tracking-tight truncate">{resumeViewModel.name}</h1>
              <p className="meta-label text-blue-600 dark:text-blue-400 -mt-1 truncate">
                {headerLabel}
              </p>
            </div>
          </div>

          <nav
            className="hidden lg:flex items-center gap-2 xl:gap-3 flex-none"
            aria-label="Primary"
          >
            {hasExperience && (
              <a
                href="#experience"
                className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
              >
                Experience
              </a>
            )}
            {hasProjects && (
              <a
                href="#projects"
                className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
              >
                Projects
              </a>
            )}
            {hasCredentials && (
              <a
                href="#credentials"
                className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
              >
                Credentials
              </a>
            )}
            {hasSkills && (
              <a
                href="#skills"
                className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
              >
                Skills
              </a>
            )}
            <a
              href="#fit-check"
              className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
            >
              Fit Check
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {RESUME_PDF_PATH && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="inline-flex shrink-0 rounded-full h-9 w-9 px-0 min-[540px]:w-auto min-[540px]:px-3 sm:px-4 whitespace-nowrap"
              >
                <a
                  href={RESUME_PDF_PATH}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open resume PDF"
                  title="Open resume PDF"
                >
                  <FileText className="w-4 h-4 min-[540px]:mr-1.5" />
                  <span className="hidden sm:inline">Resume PDF</span>
                  <span className="hidden min-[540px]:inline sm:hidden">Resume</span>
                </a>
              </Button>
            )}
            <div className="flex shrink-0 items-center gap-1 border-r pr-2 sm:pr-3">
              <Button asChild variant="ghost" size="icon">
                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open LinkedIn profile"
                  title="LinkedIn"
                >
                  <Linkedin className="w-4 h-4" />
                </a>
              </Button>
              <EmailButton
                email={contact.email}
                label={`Email ${firstName}`}
                iconOnly
                variant="ghost"
                size="icon"
              />
            </div>
            <ThemeToggle className="relative top-0 right-0 shrink-0" />
          </div>
        </div>
      </div>
    </header>
  )
}
