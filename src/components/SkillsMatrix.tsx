import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resumeViewModel } from '@/data/resume'
import { GraduationCap, Hammer, Star } from 'lucide-react'
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
    <section
      id="skills"
      className="relative left-1/2 w-[calc(100vw-2rem)] max-w-[80rem] -translate-x-1/2 scroll-mt-24"
      aria-labelledby="skills-title"
    >
      <div className="mb-12 md:mb-14 space-y-3">
        <h2 id="skills-title" className="text-3xl md:text-4xl font-bold tracking-tight">
          Technical Competencies
        </h2>
        <p className="meta-label">Core strengths, applied tools, and current learning focus</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-7">
        {coreStrengths.length > 0 && (
          <Card className="border-2 border-blue-200 bg-blue-50/70 dark:border-blue-800/60 dark:bg-blue-950/30">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                <Star className="w-5 h-5" />
                Core Strengths
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {coreStrengths.map((skill) => (
                <Badge
                  key={skill}
                  variant="outline"
                  className="border-blue-300 bg-blue-100 text-blue-900 shadow-sm hover:bg-blue-200 dark:border-blue-700 dark:bg-blue-900/50 dark:text-blue-100 dark:hover:bg-blue-900/70"
                >
                  {skill}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}
        {appliedAndDeveloping.length > 0 && (
          <Card className="border-2 border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
                <Hammer className="w-5 h-5" />
                Applied / Developing
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {appliedAndDeveloping.map((skill) => (
                <Badge
                  key={skill}
                  variant="outline"
                  className="border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  {skill}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}
        {currentLearningFocus.length > 0 && (
          <Card className="border-2 border-sky-200 bg-sky-50/70 dark:border-sky-800/60 dark:bg-sky-950/25">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-sky-800 dark:text-sky-200">
                <GraduationCap className="w-5 h-5" />
                Growth Areas
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {currentLearningFocus.map((skill) => (
                <Badge
                  key={skill}
                  variant="outline"
                  className="border-sky-300 bg-white text-sky-800 shadow-sm hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/45 dark:text-sky-100 dark:hover:bg-sky-800/60"
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
