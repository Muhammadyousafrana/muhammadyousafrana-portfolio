import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resumeViewModel } from '@/data/resume'
import { Award, BadgeCheck, ShieldCheck, Users } from 'lucide-react'

export function CredentialHighlights() {
  const leadership = resumeViewModel.leadership.slice(0, 2)
  const certifications = resumeViewModel.certifications
  const awards = resumeViewModel.awards.slice(0, 1)
  const certificationsOnly = leadership.length === 0 && awards.length === 0

  if (leadership.length === 0 && certifications.length === 0 && awards.length === 0) {
    return null
  }

  return (
    <section id="credentials" className="scroll-mt-24 w-full" aria-labelledby="credentials-title">
      <div className="flex items-center gap-3 mb-8">
        <div className="size-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
          <ShieldCheck className="w-5 h-5 text-zinc-600 dark:text-zinc-300" aria-hidden="true" />
        </div>
        <div>
          <h2
            id="credentials-title"
            className="text-xl sm:text-2xl font-bold tracking-tight text-foreground"
          >
            Leadership And Credentials
          </h2>
          <p className="meta-label mt-0.5 text-zinc-500">
            Leadership, credentials, and recognition
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {leadership.length > 0 && (
          <Card className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors h-full">
            <CardHeader className="pb-3.5">
              <CardTitle className="flex items-center gap-2 text-foreground text-sm font-bold">
                <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Leadership
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {leadership.map((item) => (
                <article key={`${item.organization}-${item.title}`} className="space-y-1.5">
                  <p className="font-semibold text-foreground">{item.title}</p>
                  <p className="text-muted-foreground text-xs sm:text-sm">{item.organization}</p>
                  {item.period && <p className="date-pill w-fit">{item.period}</p>}
                </article>
              ))}
            </CardContent>
          </Card>
        )}

        {certifications.length > 0 && (
          <Card
            className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors h-full ${
              certificationsOnly ? 'md:col-span-3' : ''
            }`}
          >
            <CardHeader className="pb-3.5">
              <CardTitle className="flex items-center gap-2 text-foreground text-sm font-bold">
                <BadgeCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Certification
              </CardTitle>
            </CardHeader>
            <CardContent
              className={
                certificationsOnly
                  ? 'grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3'
                  : 'space-y-4 text-sm'
              }
            >
              {certifications.map((item) => (
                <article
                  key={item.title}
                  className={`space-y-1.5 ${
                    certificationsOnly
                      ? 'rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40 p-4'
                      : ''
                  }`}
                >
                  <p className="font-semibold text-foreground">{item.title}</p>
                  <p className="text-muted-foreground text-xs sm:text-sm">{item.organization}</p>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline pt-0.5"
                    >
                      Verify credential
                      <span aria-hidden="true">↗</span>
                    </a>
                  )}
                </article>
              ))}
            </CardContent>
          </Card>
        )}

        {awards.length > 0 && (
          <Card className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors h-full">
            <CardHeader className="pb-3.5">
              <CardTitle className="flex items-center gap-2 text-foreground text-sm font-bold">
                <Award className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Award
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {awards.map((item) => (
                <article key={item.title} className="space-y-1.5">
                  <p className="font-semibold text-foreground">{item.title}</p>
                  <p className="text-muted-foreground text-xs sm:text-sm">{item.detail}</p>
                  {item.period && <p className="date-pill w-fit">{item.period}</p>}
                </article>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}
