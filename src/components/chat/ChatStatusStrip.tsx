import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Loader2, RotateCw, TriangleAlert } from 'lucide-react'

type ChatStatusStripProps = {
  tone: 'info' | 'error'
  message: string
  canRetry: boolean
  onRetry: () => void
}

export function ChatStatusStrip({ tone, message, canRetry, onRetry }: ChatStatusStripProps) {
  const isError = tone === 'error'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={cn(
        'mb-3 flex flex-col gap-2 rounded-xl border px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:text-sm',
        isError
          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
          : 'border-slate-200 bg-secondary/70 text-muted-foreground dark:border-slate-800'
      )}
    >
      <span className="inline-flex items-start gap-2 leading-relaxed">
        {isError ? (
          <TriangleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <Loader2
            className="mt-px h-3.5 w-3.5 shrink-0 animate-spin text-blue-600"
            aria-hidden="true"
          />
        )}
        <span>{message}</span>
      </span>
      {isError && canRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-8 shrink-0 gap-1.5 self-start border-red-300 bg-background px-3 text-red-700 hover:bg-red-100/70 hover:text-red-800 dark:border-red-900/60 dark:text-red-200 dark:hover:bg-red-950/60 sm:self-auto"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  )
}
