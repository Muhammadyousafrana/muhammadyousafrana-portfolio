import { BadgeCheck, Code2, Github, Linkedin } from 'lucide-react'

type Profile = { label: string; url: string }

function ProfileMark({ label }: { label: string }) {
  if (label === 'LinkedIn') return <Linkedin className="size-4" aria-hidden="true" />
  if (label === 'GitHub') return <Github className="size-4" aria-hidden="true" />
  if (label === 'Kaggle') {
    return (
      <svg viewBox="0 0 24 24" className="size-4 text-sky-500" aria-hidden="true">
        <path
          d="M5 3v18M8 13 18 3M8 13l10 8M13 8l6-5M14 17l5 4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
      </svg>
    )
  }
  if (label === 'Hugging Face') {
    return (
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="#FFD21E" />
        <path
          d="M6 13c1.2 3.2 3.2 5 6 5s4.8-1.8 6-5M8.5 10h.1m6.8 0h.1M4.5 13l2.2 1.2m12.8-1.2-2.2 1.2"
          fill="none"
          stroke="#5B308F"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    )
  }
  if (label === 'Credly')
    return <BadgeCheck className="size-4 text-orange-500" aria-hidden="true" />
  if (label === 'Google Developer') {
    return (
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
        <path
          d="M8 5 3 12l5 7"
          fill="none"
          stroke="#4285F4"
          strokeLinecap="round"
          strokeWidth="2.5"
        />
        <path
          d="m16 5 5 7-5 7"
          fill="none"
          stroke="#34A853"
          strokeLinecap="round"
          strokeWidth="2.5"
        />
        <path
          d="M13.5 4.5 10.5 19.5"
          fill="none"
          stroke="#FBBC04"
          strokeLinecap="round"
          strokeWidth="2.5"
        />
      </svg>
    )
  }
  return <Code2 className="size-4" aria-hidden="true" />
}

export function ProfileLinks({ profiles }: { profiles: Profile[] }) {
  return (
    <nav
      className="max-w-7xl mx-auto px-4 pt-8 flex flex-wrap justify-center gap-3"
      aria-label="Professional profiles"
    >
      {profiles.map((profile) => (
        <a
          key={profile.label}
          href={profile.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
        >
          <ProfileMark label={profile.label} />
          {profile.label}
        </a>
      ))}
    </nav>
  )
}
