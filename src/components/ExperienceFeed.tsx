import { resumeViewModel } from '@/data/resume'
import { Briefcase, Wrench } from 'lucide-react'

interface ExperienceItemProps {
  item: (typeof resumeViewModel.experience)[0]
}

function ExperienceItem({ item }: ExperienceItemProps) {
  return (
    <div className="relative pl-8 md:pl-9 border-l-2 border-slate-200 dark:border-slate-800 pb-12 md:pb-14 last:pb-0">
      <div
        className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-blue-600 border-4 border-background"
        aria-hidden="true"
      />
      <div className="space-y-[18px]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
          <h3 className="text-xl font-bold tracking-tight">{item.title}</h3>
          <span className="date-pill w-fit">{item.period}</span>
        </div>

        <p className="meta-label text-blue-700 dark:text-blue-300">{item.organization}</p>

        <p className="text-muted-foreground text-sm md:text-base max-w-2xl leading-relaxed">
          {item.summary}
        </p>

        <ul className="space-y-2.5 list-disc pl-5 marker:text-slate-400 dark:marker:text-slate-500">
          {item.bullets.map((bullet, idx) => (
            <li key={`${item.id}-${idx}`} className="text-sm leading-relaxed text-foreground/90">
              {bullet}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function ExperienceFeed() {
  const { experience, projects } = resumeViewModel

  // Nothing to show: hide the whole section. Each block below also hides on its
  // own, and each carries its own anchor id so the header nav resolves correctly
  // whichever block renders (no dangling `aria-labelledby` on the wrapper).
  if (experience.length === 0 && projects.length === 0) {
    return null
  }

  return (
    // A plain layout wrapper; each populated block below is its own labeled
    // <section> landmark carrying the anchor id the header nav targets.
    <div className="space-y-20 md:space-y-24">
      {experience.length > 0 && (
        <section id="experience" className="scroll-mt-24" aria-labelledby="experience-title">
          <div className="flex items-center gap-4 mb-10 md:mb-12">
            <div className="w-11 h-11 md:w-12 md:h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center border border-blue-100 dark:border-blue-800">
              <Briefcase className="w-6 h-6 text-blue-600" aria-hidden="true" />
            </div>
            <div>
              <h2 id="experience-title" className="text-3xl md:text-4xl font-bold tracking-tight">
                Professional Experience
              </h2>
              <p className="meta-label">Career Timeline</p>
            </div>
          </div>
          <div className="space-y-0">
            {experience.map((exp) => (
              <ExperienceItem key={exp.id} item={exp} />
            ))}
          </div>
        </section>
      )}

      {projects.length > 0 && (
        <section id="projects" className="scroll-mt-24" aria-labelledby="projects-title">
          <div className="flex items-center gap-4 mb-10 md:mb-12">
            <div className="w-11 h-11 md:w-12 md:h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center border border-indigo-100 dark:border-indigo-800">
              <Wrench className="w-6 h-6 text-indigo-600" aria-hidden="true" />
            </div>
            <div>
              <h2 id="projects-title" className="text-3xl md:text-4xl font-bold tracking-tight">
                Key Projects
              </h2>
              <p className="meta-label">Technical Artifacts</p>
            </div>
          </div>
          <div className="space-y-0">
            {projects.map((proj) => (
              <ExperienceItem key={proj.id} item={proj} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
