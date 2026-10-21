import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resumeViewModel } from '@/data/resume'
import { Compass, Hammer, Sparkles, Star } from 'lucide-react'

export function SkillsMatrix() {
  const { coreStrengths, appliedAndDeveloping, currentLearningFocus } = resumeViewModel.skills

  // Hide the whole section (heading included) when no skill list has entries.
  if (
    coreStrengths.length === 0 &&
    appliedAndDeveloping.length === 0 &&
    currentLearningFocus.length === 0
  ) {
    return null
  }

  return (
    <section id="skills" className="scroll-mt-24 w-full" aria-labelledby="skills-title">
      <div className="flex items-center gap-3 mb-8">
        <div className="size-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
          <Sparkles className="w-5 h-5 text-zinc-600 dark:text-zinc-300" aria-hidden="true" />
        </div>
        <div>
          <h2
            id="skills-title"
            className="text-xl sm:text-2xl font-bold tracking-tight text-foreground"
          >
            Technical Competencies
          </h2>
          <p className="meta-label mt-0.5 text-zinc-500">
            Core strengths, applied tools, and current learning focus
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {coreStrengths.length > 0 && (
          <Card className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
            <CardHeader className="pb-3.5">
              <CardTitle className="flex items-center gap-2 text-foreground text-sm font-bold">
                <Star className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Core Strengths
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {coreStrengths.map((skill) => (
                <Badge
                  key={skill}
                  variant="outline"
                  className="rounded-md border-blue-200/80 bg-blue-50/60 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 px-2.5 py-1 text-xs font-medium shadow-none"
                >
                  {skill}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}

        {appliedAndDeveloping.length > 0 && (
          <Card className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
            <CardHeader className="pb-3.5">
              <CardTitle className="flex items-center gap-2 text-foreground text-sm font-bold">
                <Hammer className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                Applied / Developing
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {appliedAndDeveloping.map((skill) => (
                <Badge
                  key={skill}
                  variant="outline"
                  className="rounded-md border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200 px-2.5 py-1 text-xs font-medium shadow-none hover:bg-zinc-100 dark:hover:bg-zinc-700/60 transition-colors"
                >
                  {skill}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}

        {currentLearningFocus.length > 0 && (
          <Card className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
            <CardHeader className="pb-3.5">
              <CardTitle className="flex items-center gap-2 text-foreground text-sm font-bold">
                <Compass className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                Growth Areas
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {currentLearningFocus.map((skill) => (
                <Badge
                  key={skill}
                  variant="outline"
                  className="rounded-md border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200 px-2.5 py-1 text-xs font-medium shadow-none hover:bg-zinc-100 dark:hover:bg-zinc-700/60 transition-colors"
                >
                  {skill}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}
