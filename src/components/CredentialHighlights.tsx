import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resumeViewModel } from '@/data/resume'
import { Award, BadgeCheck, Users } from 'lucide-react'

export function CredentialHighlights() {
  const leadership = resumeViewModel.leadership.slice(0, 2)
  const certifications = resumeViewModel.certifications.slice(0, 1)
  const awards = resumeViewModel.awards.slice(0, 1)

  // Nothing to show: hide the whole section (heading included) rather than render
  // an empty shell. Individual cards below hide the same way when their list is empty.
  if (leadership.length === 0 && certifications.length === 0 && awards.length === 0) {
    return null
  }

  return (
    <section id="credentials" className="scroll-mt-24" aria-labelledby="credentials-title">
      <div className="mb-10 md:mb-12 space-y-3">
        <h2 id="credentials-title" className="text-3xl md:text-4xl font-bold tracking-tight">
          Leadership And Credentials
        </h2>
        <p className="meta-label">Leadership, credentials, and recognition.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {leadership.length > 0 && (
          <Card className="border-2 border-blue-200/70 dark:border-blue-700/50 bg-blue-50/35 dark:bg-blue-900/20 h-full">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300 text-base">
                <Users className="w-4 h-4" />
                Leadership
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {leadership.map((item) => (
                <article key={`${item.organization}-${item.title}`} className="space-y-1.5">
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-muted-foreground">{item.organization}</p>
                  <p className="date-pill w-fit">{item.period}</p>
                </article>
              ))}
            </CardContent>
          </Card>
        )}

        {certifications.length > 0 && (
          <Card className="border-2 border-indigo-200/70 dark:border-indigo-700/50 bg-indigo-50/35 dark:bg-indigo-900/20 h-full">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 text-base">
                <BadgeCheck className="w-4 h-4" />
                Certification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {certifications.map((item) => (
                <article key={item.title} className="space-y-1.5">
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-muted-foreground">{item.organization}</p>
                  <p className="date-pill w-fit">{item.period}</p>
                </article>
              ))}
            </CardContent>
          </Card>
        )}

        {awards.length > 0 && (
          <Card className="border-2 border-emerald-200/70 dark:border-emerald-700/50 bg-emerald-50/35 dark:bg-emerald-900/20 h-full">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-base">
                <Award className="w-4 h-4" />
                Award
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {awards.map((item) => (
                <article key={item.title} className="space-y-1.5">
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-muted-foreground">{item.detail}</p>
                  <p className="date-pill w-fit">{item.period}</p>
                </article>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}
