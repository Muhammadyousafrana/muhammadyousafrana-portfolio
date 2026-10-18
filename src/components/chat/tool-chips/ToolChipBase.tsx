import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type ToolChipStatus = 'running' | 'completed' | 'error'

const STATUS_LABELS: Record<ToolChipStatus, string> = {
  running: 'Running',
  completed: 'Done',
  error: 'Error',
}

const STATUS_CLASSES: Record<ToolChipStatus, string> = {
  running: 'text-amber-700 dark:text-amber-400',
  completed: 'text-emerald-700 dark:text-emerald-400',
  error: 'text-red-700 dark:text-red-400',
}

type ToolChipBaseProps = {
  title: string
  status: ToolChipStatus
  summary?: string
  error?: string
  className?: string
  children?: ReactNode
}

export function ToolChipBase({
  title,
  status,
  summary,
  error,
  className,
  children,
}: ToolChipBaseProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-background/70 px-2.5 py-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-xs">{title}</span>
        <span className={cn('text-[10px] uppercase tracking-wide', STATUS_CLASSES[status])}>
          {STATUS_LABELS[status]}
        </span>
      </div>

      {summary && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{summary}</p>}
      {error && <p className="mt-1 text-xs text-red-600 leading-relaxed">{error}</p>}
      {children}
    </div>
  )
}
