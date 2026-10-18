import {
  celsiusToFahrenheit,
  setTemperatureUnit,
  useTemperatureUnit,
  type TemperatureUnit,
} from '@/lib/temperature-unit'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  TriangleAlert,
} from 'lucide-react'

type WeatherCardState = 'running' | 'done' | 'error'

type WeatherCardProps = {
  state: WeatherCardState
  /** result.resolvedLocation ?? result.location ?? args.location */
  location?: string
  /** result.temperature — °C, one decimal from the worker */
  temperature?: number
  /** result.condition — worker packs it as "Overcast, wind 14.3 km/h" */
  condition?: string
  /** result.humidity — integer percent */
  humidity?: number
  errorMessage?: string
}

/** The worker packs wind speed into the condition string; unpack for display. */
const parseCondition = (condition?: string): { text?: string; windKph?: number } => {
  if (!condition) return {}
  const match = condition.match(/^(.*?),\s*wind\s+([\d.]+)\s*km\/h$/i)
  if (!match) return { text: condition }
  const windKph = Number.parseFloat(match[2])
  return { text: match[1], windKph: Number.isFinite(windKph) ? windKph : undefined }
}

type GlyphKind = 'sun' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

/**
 * Open-Meteo WMO condition text (WEATHER_CODE_MAP in worker/tools.ts) → glyph.
 * Order matters: "Slight snow showers" must hit snow before the showers→rain
 * check, and "Partly cloudy" / "Mainly clear" must resolve before the bare
 * "clear" → sun check. Rime is frozen, so it reads as snow.
 */
const glyphForCondition = (text: string): GlyphKind => {
  const c = text.toLowerCase()
  if (c.includes('thunder')) return 'storm'
  if (c.includes('snow') || c.includes('rime') || c.includes('grains')) return 'snow'
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return 'rain'
  if (c.includes('fog')) return 'fog'
  if (c.includes('partly') || c.includes('mainly clear')) return 'partly'
  if (c.includes('clear') || c.includes('sun')) return 'sun'
  return 'cloud' // Overcast, "Code N", Unknown
}

// Shape stays the primary (grayscale-safe) cue; the tint is the expressive
// element, in two layers so it can be loud without lying about contrast:
// `wash` is the full-card corner gradient — its ceiling is wherever
// muted-foreground text can sit (measured: cool tints /10 light, all /25
// dark; amber /15 light). `glow` is a blurred blob pinned behind the glyph
// in the top-right corner, where only the aria-hidden icon lives, so it can
// run much hotter — by the time its blur decays into text territory the
// effective alpha is back under the wash ceiling. Overcast/fog get chromatic
// tints (indigo/steel) instead of gray-on-gray, which was invisible against
// the chat background. Full class strings so Tailwind emits them.
const GLYPHS: Record<GlyphKind, { Icon: LucideIcon; tint: string; wash: string; glow: string }> = {
  sun: {
    Icon: Sun,
    tint: 'text-amber-500 dark:text-amber-400',
    wash: 'from-amber-500/15 dark:from-amber-400/25',
    glow: 'bg-amber-500/30 dark:bg-amber-400/35',
  },
  partly: {
    Icon: CloudSun,
    tint: 'text-amber-500 dark:text-amber-400',
    wash: 'from-amber-500/15 dark:from-amber-400/25',
    glow: 'bg-amber-500/30 dark:bg-amber-400/35',
  },
  cloud: {
    Icon: Cloud,
    tint: 'text-indigo-500 dark:text-indigo-400',
    wash: 'from-indigo-500/10 dark:from-indigo-400/25',
    glow: 'bg-indigo-500/30 dark:bg-indigo-400/35',
  },
  fog: {
    Icon: CloudFog,
    tint: 'text-slate-500 dark:text-slate-400',
    wash: 'from-slate-500/10 dark:from-slate-400/25',
    glow: 'bg-slate-500/30 dark:bg-slate-400/35',
  },
  rain: {
    Icon: CloudRain,
    tint: 'text-sky-600 dark:text-sky-400',
    wash: 'from-sky-600/10 dark:from-sky-400/25',
    glow: 'bg-sky-600/30 dark:bg-sky-400/35',
  },
  snow: {
    Icon: CloudSnow,
    tint: 'text-sky-500 dark:text-sky-300',
    wash: 'from-sky-500/10 dark:from-sky-300/25',
    glow: 'bg-sky-500/30 dark:bg-sky-300/35',
  },
  storm: {
    Icon: CloudLightning,
    tint: 'text-violet-600 dark:text-violet-400',
    wash: 'from-violet-600/10 dark:from-violet-400/25',
    glow: 'bg-violet-600/30 dark:bg-violet-400/35',
  },
}

const CARD = 'relative overflow-hidden rounded-xl border border-border bg-card px-3 py-2 shadow-sm'
const KICKER = 'truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground'

const UNIT_SEGMENTS: Array<{ unit: TemperatureUnit; label: string; name: string }> = [
  { unit: 'F', label: '°F', name: 'Fahrenheit' },
  { unit: 'C', label: '°C', name: 'Celsius' },
]

/**
 * Segmented °F | °C control. The active segment is primary-filled (a luminance
 * change that reads in grayscale, not color-only) and carries aria-pressed.
 * `ml-auto` keeps it pinned right whether or not a kicker shares the row.
 */
function UnitToggle({ unit }: { unit: TemperatureUnit }) {
  return (
    <div
      role="group"
      aria-label="Temperature unit"
      className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md bg-muted/50 p-0.5"
    >
      {UNIT_SEGMENTS.map((segment) => (
        <button
          key={segment.unit}
          type="button"
          aria-pressed={unit === segment.unit}
          aria-label={segment.name}
          onClick={() => setTemperatureUnit(segment.unit)}
          className={cn(
            'min-h-6 min-w-7 rounded px-1.5 text-xs font-medium tabular-nums transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
            // Primary fill for the pressed segment: the state reads as a
            // luminance change (≥4.7:1 vs the group in both modes over any
            // wash), so it survives grayscale — never a color-only cue.
            unit === segment.unit
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {segment.label}
        </button>
      ))}
    </div>
  )
}

export function WeatherCard({
  state,
  location,
  temperature,
  condition,
  humidity,
  errorMessage,
}: WeatherCardProps) {
  const unit = useTemperatureUnit()

  if (state === 'running') {
    // Skeleton in the exact final geometry (same rows, same heights) so nothing
    // jumps when the data lands. The toggle is real and interactive already;
    // role="status" stays on the text so the live region never wraps a widget.
    return (
      <div className={CARD}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-foreground/5 to-transparent motion-reduce:hidden"
        />
        <p role="status" className={KICKER}>
          {location ? `Checking — ${location}` : 'Checking weather'}
        </p>
        <div aria-hidden="true" className="mt-0.5 flex items-center justify-between gap-3">
          <p className="text-5xl font-semibold leading-none tracking-tighter tabular-nums text-muted-foreground/40">
            ––°
          </p>
          <div className="h-9 w-9 shrink-0 rounded-full bg-muted-foreground/10" />
        </div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div aria-hidden="true" className="min-w-0">
            <div className="h-5 w-24 rounded bg-muted-foreground/10" />
            <div className="mt-0.5 h-4 w-32 rounded bg-muted-foreground/10" />
          </div>
          <UnitToggle unit={unit} />
        </div>
      </div>
    )
  }

  // Error, or a "done" result missing its one non-negotiable number.
  if (state === 'error' || temperature === undefined) {
    return (
      <div className={CARD}>
        <p className={KICKER}>Weather</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          Couldn&apos;t get the weather
        </p>
        {/* The worker packs the guidance into the message itself — a lookup miss
            invites a rephrase, a transient failure invites a retry — so render it
            verbatim instead of always appending "ask again". */}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {errorMessage ?? 'The weather service didn’t answer. Please try again in a moment.'}
        </p>
      </div>
    )
  }

  const { text: conditionText, windKph } = parseCondition(condition)
  const glyph = GLYPHS[glyphForCondition(conditionText ?? '')]
  const displayTemperature = unit === 'F' ? celsiusToFahrenheit(temperature) : temperature
  // Screen readers keep exact-ish values (always one decimal, in the ACTIVE
  // unit — toFixed keeps "10.0" unambiguous); the visual layer rounds whole.
  const exactTemperature = displayTemperature.toFixed(1)
  const metaLine = [
    windKph !== undefined ? `Wind ${Math.round(windKph)} km/h` : undefined,
    humidity !== undefined ? `Humidity ${humidity}%` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={cn(CARD, 'bg-gradient-to-bl to-transparent', glyph.wash)}>
      {/* Condition glow: hot color lives only in the glyph's corner (no text
          there); blur-2xl decays it below the wash ceiling before it reaches
          the kicker or meta line. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -right-8 -top-10 h-28 w-44 rounded-full blur-2xl',
          glyph.glow
        )}
      />
      {/* aria-live so a unit flip re-announces the reading in the new unit.
          With several cards mounted this announces once per card — accepted:
          multiple weather cards in one chat is the rare case. */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {`Current weather in ${location ?? 'the requested location'}: ${exactTemperature} degrees ${
          unit === 'F' ? 'Fahrenheit' : 'Celsius'
        }, ${conditionText ?? 'conditions unknown'}${
          windKph !== undefined ? `, wind ${windKph} kilometres per hour` : ''
        }${humidity !== undefined ? `, humidity ${humidity} percent` : ''}.`}
      </span>
      {location && (
        <p className={KICKER} aria-hidden="true">
          {location}
        </p>
      )}
      <div aria-hidden="true" className="mt-0.5 flex items-center justify-between gap-3">
        <p className="text-5xl font-semibold leading-none tracking-tighter tabular-nums text-foreground">
          {Math.round(displayTemperature)}°
        </p>
        <glyph.Icon className={cn('h-9 w-9 shrink-0', glyph.tint)} strokeWidth={1.5} />
      </div>
      {/* The toggle is a real control, so it lives OUTSIDE the aria-hidden
          visual layer; everything the sr sentence already covers is hidden. */}
      <div className="mt-1 flex items-end justify-between gap-3">
        <div aria-hidden="true" className="min-w-0">
          <p className="text-sm leading-snug text-foreground">
            {conditionText ?? 'Current conditions'}
          </p>
          {metaLine && <p className="text-xs tabular-nums text-muted-foreground">{metaLine}</p>}
        </div>
        <UnitToggle unit={unit} />
      </div>
    </div>
  )
}
