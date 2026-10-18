import { CHAT_TOOL_NAME } from '../shared/chat-tools'
import type { ErrorResult, WeatherResult } from './types'

// Keep the local executor limited to live product tools. If search comes back,
// add its name here and extend ToolExecutionContext with the request-scoped inputs it needs.
export type LocalToolName = typeof CHAT_TOOL_NAME.getWeather
export interface RequestLocationContext {
  latitude?: number
  longitude?: number
  city?: string
  region?: string
  country?: string
  timezone?: string
}

export interface ToolExecutionContext {
  requestLocation?: RequestLocationContext
}

interface OpenMeteoForecastResponse {
  current?: {
    temperature_2m?: number
    relative_humidity_2m?: number
    wind_speed_10m?: number
    weather_code?: number
  }
}

interface OpenMeteoGeocodeResponse {
  results?: Array<{
    name?: string
    admin1?: string
    country?: string
    latitude?: number
    longitude?: number
  }>
}

const WEATHER_CODE_MAP: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
}

const GEOCODE_CANDIDATE_COUNT = 10

// Transport-layer failures (network, timeout, non-2xx, unparseable body) are
// transient: the place may well exist, the provider just didn't answer. They are
// deliberately distinct from a successful lookup that simply found no match, which
// is a deterministic miss no amount of retrying will fix (see resolveLocationFromName).
const TRANSIENT_WEATHER_ERROR =
  'The weather service is unavailable right now. Please try again in a moment.'

// Only messages carried by this class are safe to show the user verbatim. Any other
// thrown value (e.g. a stray TypeError from a malformed provider body) is mapped to
// the transient copy by executeLocalTool, so internal strings never leak.
class WeatherError extends Error {}

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const fetchWeatherJson = async <T>(url: string): Promise<T> => {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new WeatherError(TRANSIENT_WEATHER_ERROR)
  }
  if (!response.ok) {
    throw new WeatherError(TRANSIENT_WEATHER_ERROR)
  }
  try {
    return (await response.json()) as T
  } catch {
    throw new WeatherError(TRANSIENT_WEATHER_ERROR)
  }
}

const weatherCodeToCondition = (code: number | undefined): string => {
  if (typeof code !== 'number' || !Number.isFinite(code)) return 'Unknown'
  return WEATHER_CODE_MAP[code] ?? `Code ${code}`
}

const buildOpenMeteoForecastUrl = (
  latitude: number,
  longitude: number,
  timezone: string
): string => {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', latitude.toString())
  url.searchParams.set('longitude', longitude.toString())
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code')
  url.searchParams.set('timezone', timezone)
  return url.toString()
}

const buildOpenMeteoGeocodeUrl = (location: string, count: number): string => {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.searchParams.set('name', location)
  url.searchParams.set('count', count.toString())
  url.searchParams.set('language', 'en')
  url.searchParams.set('format', 'json')
  return url.toString()
}

type ResolvedLocation = {
  name: string
  latitude: number
  longitude: number
  timezone: string
}

type GeocodeCandidate = NonNullable<OpenMeteoGeocodeResponse['results']>[number]
type LocatedGeocodeCandidate = GeocodeCandidate & { latitude: number; longitude: number }

const hasCoordinates = (candidate: GeocodeCandidate): candidate is LocatedGeocodeCandidate =>
  typeof candidate.latitude === 'number' && typeof candidate.longitude === 'number'

// Lowercased, diacritics stripped, punctuation collapsed to spaces. Used to
// compare the model's free-text ("Zürich", "St. Louis", "NY") against the
// canonical fields Open-Meteo returns.
const normalizeForMatch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Open-Meteo matches the `name` param against place names and does handle full
// "City, Country" strings ("Paris, France" resolves), but returns zero results
// for the abbreviated regions the model naturally sends ("New York, NY"). So try
// the full string first, then relax to the part before the first comma. The tail
// after the comma is kept as region hints to disambiguate same-named cities.
const buildGeocodeQueries = (
  location: string
): { queries: string[]; expectedName: string; regionHints: string[] } => {
  const trimmed = location.trim()
  const commaIndex = trimmed.indexOf(',')
  const queries = [trimmed]
  let expectedName = trimmed
  let regionHints: string[] = []
  if (commaIndex > 0) {
    const head = trimmed.slice(0, commaIndex).trim()
    if (head) {
      expectedName = head
      if (head !== trimmed) queries.push(head)
    }
    regionHints = trimmed
      .slice(commaIndex + 1)
      .split(',')
      .map((part) => normalizeForMatch(part))
      .filter((part) => part.length >= 2)
  }
  return { queries: [...new Set(queries.filter(Boolean))], expectedName, regionHints }
}

// A hint honors a region when it equals or prefixes the region's normalized name,
// or matches the initials of a multi-word region ("NY"→New York, "BC"→British
// Columbia, "UK"→United Kingdom). Two-letter USPS codes that are neither a prefix
// nor initials ("ME"→Maine, "TX"→Texas) intentionally fall through to relevance
// rank rather than pull in a whole abbreviation table.
const regionFieldMatchesHint = (field: string | undefined, hint: string): boolean => {
  if (!field) return false
  const normalized = normalizeForMatch(field)
  if (!normalized) return false
  if (normalized === hint || normalized.startsWith(hint)) return true
  const initials = normalized
    .split(' ')
    .map((word) => word[0])
    .join('')
  return initials.length >= 2 && initials === hint
}

// A candidate's name matches the queried city when it equals it or extends it at a
// word boundary — so "Washington D.C." and "New York City" still count as matches,
// while "Macomb"/"Parisville" do not.
const nameMatchesQuery = (
  candidateName: string | undefined,
  normalizedExpected: string
): boolean => {
  if (!candidateName || !normalizedExpected) return false
  const normalized = normalizeForMatch(candidateName)
  return normalized === normalizedExpected || normalized.startsWith(`${normalizedExpected} `)
}

// Defensively pull the candidate list out of an untyped body. `undefined` results
// is Open-Meteo's normal "no matches"; anything else non-array (or a non-object
// body like a bare `null`) is a malformed response the caller treats as transient.
const parseGeocodeResults = (data: unknown): GeocodeCandidate[] | 'malformed' => {
  if (data === null || typeof data !== 'object') return 'malformed'
  const results = (data as OpenMeteoGeocodeResponse).results
  if (results === undefined) return []
  if (!Array.isArray(results)) return 'malformed'
  return results
}

// Restrict selection to candidates whose name actually matches the queried city —
// this rejects the fuzzy noise Open-Meteo mixes into name searches (e.g. "Macomb,
// Illinois" surfacing under name=Washington). Among those, honor the region hints
// if our cheap rules can — a candidate must satisfy EVERY hint, so "Springfield, IL,
// US" cannot be won by a Missouri row that merely shares the country. Otherwise take
// the top relevance-ranked name match. If nothing name-matches at all (e.g. an alias
// like "NYC"→"New York"), trust the relevance rank rather than let a hint pull in
// unrelated noise. The chosen place is always echoed back via resolvedLocation, so
// any fallback stays visible in the UI.
const pickGeocodeResult = (
  results: GeocodeCandidate[],
  expectedName: string,
  regionHints: string[]
): LocatedGeocodeCandidate | null => {
  const valid = results.filter(hasCoordinates)
  if (valid.length === 0) return null

  const normalizedExpected = normalizeForMatch(expectedName)
  const nameMatched = valid.filter((candidate) =>
    nameMatchesQuery(candidate.name, normalizedExpected)
  )
  if (nameMatched.length === 0) return valid[0]

  if (regionHints.length > 0) {
    const hinted = nameMatched.find((candidate) =>
      regionHints.every(
        (hint) =>
          regionFieldMatchesHint(candidate.admin1, hint) ||
          regionFieldMatchesHint(candidate.country, hint)
      )
    )
    if (hinted) return hinted
  }
  return nameMatched[0]
}

const resolveLocationFromName = async (location: string): Promise<ResolvedLocation> => {
  const { queries, expectedName, regionHints } = buildGeocodeQueries(location)

  for (const query of queries) {
    const data = await fetchWeatherJson<unknown>(
      buildOpenMeteoGeocodeUrl(query, GEOCODE_CANDIDATE_COUNT)
    )
    const results = parseGeocodeResults(data)
    if (results === 'malformed') {
      throw new WeatherError(TRANSIENT_WEATHER_ERROR)
    }
    if (results.length === 0) {
      continue
    }
    const picked = pickGeocodeResult(results, expectedName, regionHints)
    // Results came back but none carried usable coordinates — a provider glitch,
    // not a "no such place" miss.
    if (!picked) {
      throw new WeatherError(TRANSIENT_WEATHER_ERROR)
    }
    const parts = [picked.name, picked.admin1, picked.country].filter(Boolean)
    return {
      name: parts.join(', ') || location,
      latitude: picked.latitude,
      longitude: picked.longitude,
      timezone: 'auto',
    }
  }

  // A successful search that found no usable match is a deterministic miss, not a
  // transient failure — retrying will not change the answer, so the copy invites a
  // different phrasing instead of telling the user to try again.
  throw new WeatherError(
    `Couldn't find weather for "${location}". Try a nearby city, or add the country (e.g. "Paris, France").`
  )
}

const resolveLocationFromCoordinates = async (
  latitude: number,
  longitude: number,
  fallbackName?: string,
  timezone?: string
): Promise<ResolvedLocation> => {
  // Open-Meteo's reverse-geocode endpoint is gone (HTTP 404), so coordinates cannot be
  // turned into a place name — use the caller's fallback label (a Cloudflare-provided
  // city, or a lat/lon string) directly.
  return {
    name: fallbackName || `Lat ${latitude.toFixed(4)}, Lon ${longitude.toFixed(4)}`,
    latitude,
    longitude,
    timezone: timezone || 'auto',
  }
}

const fetchCurrentWeather = async (
  latitude: number,
  longitude: number,
  locationLabel: string,
  timezone: string
): Promise<WeatherResult & { windSpeedKph: number }> => {
  const data = await fetchWeatherJson<OpenMeteoForecastResponse>(
    buildOpenMeteoForecastUrl(latitude, longitude, timezone)
  )
  const current = data.current
  const temperature = current ? toFiniteNumber(current.temperature_2m) : null
  const humidity = current ? toFiniteNumber(current.relative_humidity_2m) : null
  const windSpeed = current ? toFiniteNumber(current.wind_speed_10m) : null
  // A 200 that omits the current block or its numbers is a provider hiccup, not a
  // user error — surface the transient copy rather than an internal string.
  if (!current || temperature === null || humidity === null || windSpeed === null) {
    throw new WeatherError(TRANSIENT_WEATHER_ERROR)
  }

  return {
    location: locationLabel,
    temperature: Number(temperature.toFixed(1)),
    humidity: Math.round(humidity),
    condition: weatherCodeToCondition(current.weather_code),
    windSpeedKph: Number(windSpeed.toFixed(1)),
  }
}

const formatRequestLocationLabel = (requestLocation: RequestLocationContext): string => {
  const parts = [requestLocation.city, requestLocation.region, requestLocation.country].filter(
    Boolean
  )
  if (parts.length > 0) {
    return parts.join(', ')
  }

  if (
    typeof requestLocation.latitude === 'number' &&
    typeof requestLocation.longitude === 'number'
  ) {
    return `Lat ${requestLocation.latitude.toFixed(4)}, Lon ${requestLocation.longitude.toFixed(4)}`
  }

  return 'Unknown location'
}

const buildWeatherResult = (
  weather: WeatherResult & { windSpeedKph: number },
  resolvedLocation: ResolvedLocation,
  source: 'coordinates' | 'location' | 'request_cf'
): WeatherResult => ({
  location: weather.location,
  temperature: weather.temperature,
  condition: `${weather.condition}, wind ${weather.windSpeedKph} km/h`,
  humidity: weather.humidity,
  latitude: Number(resolvedLocation.latitude.toFixed(4)),
  longitude: Number(resolvedLocation.longitude.toFixed(4)),
  resolvedLocation: resolvedLocation.name,
  timezone: resolvedLocation.timezone,
  source,
})

export async function executeLocalTool(
  name: LocalToolName,
  args: Record<string, unknown>,
  context?: ToolExecutionContext
): Promise<WeatherResult | ErrorResult> {
  try {
    if (name !== CHAT_TOOL_NAME.getWeather) {
      return { error: 'Unknown local tool' }
    }

    const hasLatitudeArg = Object.prototype.hasOwnProperty.call(args, 'latitude')
    const hasLongitudeArg = Object.prototype.hasOwnProperty.call(args, 'longitude')
    const providedLatitude = toFiniteNumber(args.latitude)
    const providedLongitude = toFiniteNumber(args.longitude)
    if (hasLatitudeArg !== hasLongitudeArg) {
      return { error: 'Latitude and longitude must be provided together.' }
    }

    if (hasLatitudeArg && hasLongitudeArg) {
      if (providedLatitude === null || providedLongitude === null) {
        return { error: 'Latitude and longitude must both be valid numbers.' }
      }

      if (providedLatitude < -90 || providedLatitude > 90) {
        return { error: 'Latitude must be between -90 and 90.' }
      }

      if (providedLongitude < -180 || providedLongitude > 180) {
        return { error: 'Longitude must be between -180 and 180.' }
      }

      const resolvedLocation = await resolveLocationFromCoordinates(
        providedLatitude,
        providedLongitude
      )
      const weather = await fetchCurrentWeather(
        providedLatitude,
        providedLongitude,
        resolvedLocation.name,
        resolvedLocation.timezone
      )
      return buildWeatherResult(weather, resolvedLocation, 'coordinates')
    }

    const locationArg = typeof args.location === 'string' ? args.location.trim() : ''
    const useRequestLocation = args.use_request_location !== false
    const requestLocation = context?.requestLocation
    if (
      !locationArg &&
      useRequestLocation &&
      requestLocation?.latitude !== undefined &&
      requestLocation.longitude !== undefined
    ) {
      const fallbackName = formatRequestLocationLabel(requestLocation)
      const resolvedLocation = await resolveLocationFromCoordinates(
        requestLocation.latitude,
        requestLocation.longitude,
        fallbackName,
        requestLocation.timezone
      )
      if (requestLocation.city) {
        resolvedLocation.name = fallbackName
      }
      const weather = await fetchCurrentWeather(
        resolvedLocation.latitude,
        resolvedLocation.longitude,
        resolvedLocation.name,
        resolvedLocation.timezone
      )
      return buildWeatherResult(weather, resolvedLocation, 'request_cf')
    }

    // No coordinates, no location arg, and no usable Cloudflare request
    // geolocation: there is nothing to look up. Return a prompt so the chat model
    // asks the user which place they mean instead of guessing a default.
    if (!locationArg) {
      return {
        error: 'No location was provided. Please specify a city (and state or country if helpful).',
      }
    }

    const resolved = await resolveLocationFromName(locationArg)
    const weather = await fetchCurrentWeather(
      resolved.latitude,
      resolved.longitude,
      resolved.name,
      resolved.timezone
    )
    return buildWeatherResult(weather, resolved, 'location')
  } catch (error) {
    // Only WeatherError carries vetted user-facing copy; anything else (a malformed
    // provider body, an unexpected bug) collapses to the transient message so no
    // internal string ever reaches the user.
    return { error: error instanceof WeatherError ? error.message : TRANSIENT_WEATHER_ERROR }
  }
}
