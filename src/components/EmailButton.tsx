import { Button, type ButtonProps } from '@/components/ui/button'
import { Mail } from 'lucide-react'

type EmailButtonProps = Omit<ButtonProps, 'asChild' | 'children' | 'title' | 'aria-label'> & {
  email: string
  label: string
  iconOnly?: boolean
}

export function EmailButton({ email, label, iconOnly = false, ...buttonProps }: EmailButtonProps) {
  const composeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`

  return (
    <Button {...buttonProps} asChild>
      <a
        href={composeUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
      >
        <Mail />
        {!iconOnly && label}
      </a>
    </Button>
  )
}
