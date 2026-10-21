import { resumeViewModel } from '@/data/resume'
import { ArrowUpRight, Briefcase, CheckCircle2, ExternalLink, Wrench } from 'lucide-react'

interface ExperienceItemProps {
  item: (typeof resumeViewModel.experience)[0]
}

function ExperienceItem({ item }: ExperienceItemProps) {
  return (
    <div className="relative pl-7 sm:pl-8 border-l border-zinc-200 dark:border-zinc-800 pb-10 last:pb-2">
      {/* Timeline Node */}
      <div
        className="absolute left-[-5px] top-1.5 size-2.5 rounded-full bg-blue-600 dark:bg-blue-500 border-2 border-background"
        aria-hidden="true"
      />

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 p-5 sm:p-6 space-y-3.5 shadow-2xs">
        {/* Title, Organization, & Period */}
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1.5 border-b border-zinc-100 dark:border-zinc-800/80 pb-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold tracking-tight text-foreground">
              {item.title}
            </h3>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 mt-0.5">
              {item.organization}
            </p>
          </div>
          {item.period && (
            <span className="date-pill w-fit self-start sm:self-auto">{item.period}</span>
          )}
        </div>

        {/* Summary Description */}
        <p className="text-muted-foreground text-sm leading-relaxed">{item.summary}</p>

        {/* Bullets with Checkmarks */}
        <ul className="space-y-2 pt-1">
          {item.bullets.map((bullet, idx) => (
            <li
              key={`${item.id}-${idx}`}
              className="text-xs sm:text-sm leading-relaxed text-foreground/90 flex items-start gap-2.5"
            >
              <CheckCircle2
                className="size-3.5 text-zinc-400 dark:text-zinc-500 shrink-0 mt-1"
                aria-hidden="true"
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        {/* Artifact Action Links */}
        {item.links.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2" aria-label={`${item.title} links`}>
            {item.links.map((link) => (
              <a
                key={`${item.id}-${link.label}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                <span>{link.label}</span>
                <ArrowUpRight className="size-3 text-muted-foreground" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectCard({ item }: ExperienceItemProps) {
  const primaryProjectLink = item.links[0]

  return (
    <article className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-2xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800/80 pb-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold tracking-tight text-foreground">
              {primaryProjectLink ? (
                <a
                  href={primaryProjectLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  <span>{item.title}</span>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                </a>
              ) : (
                item.title
              )}
            </h3>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
              {item.organization}
            </p>
          </div>
          {item.period && <span className="date-pill shrink-0">{item.period}</span>}
        </div>

        {/* Summary */}
        <p className="text-muted-foreground text-sm leading-relaxed">{item.summary}</p>

        {/* Bullets */}
        <ul className="space-y-1.5 pt-1">
          {item.bullets.map((bullet, idx) => (
            <li
              key={`${item.id}-${idx}`}
              className="text-xs sm:text-sm leading-relaxed text-foreground/90 flex items-start gap-2.5"
            >
              <span className="size-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 shrink-0 mt-2" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Outbound Actions */}
      {item.links.length > 0 && (
        <div
          className="flex flex-wrap gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800/80"
          aria-label={`${item.title} links`}
        >
          {item.links.map((link) => (
            <a
              key={`${item.id}-${link.label}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <span>{link.label}</span>
              <ExternalLink className="size-3 text-muted-foreground" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
    </article>
  )
}

export function ExperienceFeed() {
  const { experience, projects } = resumeViewModel

  if (experience.length === 0 && projects.length === 0) {
    return null
  }

  return (
    <div className="space-y-16 sm:space-y-20">
      {/* Experience Section */}
      {experience.length > 0 && (
        <section id="experience" className="scroll-mt-24" aria-labelledby="experience-title">
          <div className="flex items-center gap-3 mb-8">
            <div className="size-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
              <Briefcase className="w-5 h-5 text-zinc-600 dark:text-zinc-300" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="experience-title"
                className="text-xl sm:text-2xl font-bold tracking-tight text-foreground"
              >
                Professional Experience
              </h2>
              <p className="meta-label mt-0.5 text-zinc-500">Career Timeline</p>
            </div>
          </div>
          <div className="space-y-0">
            {experience.map((exp) => (
              <ExperienceItem key={exp.id} item={exp} />
            ))}
          </div>
        </section>
      )}

      {/* Projects Section */}
      {projects.length > 0 && (
        <section id="projects" className="scroll-mt-24" aria-labelledby="projects-title">
          <div className="flex items-center gap-3 mb-8">
            <div className="size-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
              <Wrench className="w-5 h-5 text-zinc-600 dark:text-zinc-300" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="projects-title"
                className="text-xl sm:text-2xl font-bold tracking-tight text-foreground"
              >
                Key Projects
              </h2>
              <p className="meta-label mt-0.5 text-zinc-500">Technical Artifacts</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {projects.map((proj) => (
              <ProjectCard key={proj.id} item={proj} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
