/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import { createMockFetch } from '../test-utils/create-mock-fetch'
import { executeLocalTool } from './tools'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const FORECAST_OK = {
  current: {
    temperature_2m: 12.3,
    relative_humidity_2m: 81,
    wind_speed_10m: 4.2,
    weather_code: 2,
  },
}

type GeocodeMock = {
  // name -> results array (a HIT). Any name not listed returns zero results,
  // mirroring how Open-Meteo answers 200-with-no-results for compound strings.
  hits?: Record<string, Array<Record<string, unknown>>>
  // name -> HTTP status, to simulate a transient geocoding failure.
  status?: Record<string, number>
  // name -> raw 200 body, to simulate a malformed provider response (e.g. `null`).
  raw?: Record<string, unknown>
  forecast?: unknown
  forecastStatus?: number
}

// Records which geocoding queries the tool issued so tests can assert that it
// relaxed "City, ST" to the bare city (or stopped early when the full string hit).
const withWeatherFetch = async (
  mock: GeocodeMock,
  run: (calls: { geoNames: string[] }) => Promise<void>
): Promise<void> => {
  const calls = { geoNames: [] as string[] }
  const originalFetch = globalThis.fetch
  globalThis.fetch = createMockFetch(async (input) => {
    const href =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const url = new URL(href)
    if (url.hostname === 'geocoding-api.open-meteo.com' && url.pathname.endsWith('/search')) {
      const name = url.searchParams.get('name') ?? ''
      calls.geoNames.push(name)
      const failStatus = mock.status?.[name]
      if (failStatus) return jsonResponse({}, failStatus)
      if (mock.raw && Object.prototype.hasOwnProperty.call(mock.raw, name)) {
        return jsonResponse(mock.raw[name])
      }
      return jsonResponse({ results: mock.hits?.[name] ?? [] })
    }
    if (url.hostname === 'api.open-meteo.com' && url.pathname.endsWith('/forecast')) {
      return jsonResponse(mock.forecast ?? FORECAST_OK, mock.forecastStatus ?? 200)
    }
    throw new Error(`Unexpected fetch in test: ${url.href}`)
  })
  try {
    await run(calls)
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe('executeLocalTool named-location geocoding', () => {
  it('relaxes a compound "City, ST" string to the bare city when the full query misses', async () => {
    await withWeatherFetch(
      {
        hits: {
          'New York': [
            {
              name: 'New York',
              admin1: 'New York',
              country: 'United States',
              latitude: 40.7143,
              longitude: -74.006,
            },
          ],
        },
      },
      async (calls) => {
        const result = await executeLocalTool('get_weather', { location: 'New York, NY' })
        expect(result).toMatchObject({
          resolvedLocation: 'New York, New York, United States',
          latitude: 40.7143,
          longitude: -74.006,
          source: 'location',
        })
        // Full string first (misses), then relaxed to the bare city (hits).
        expect(calls.geoNames).toEqual(['New York, NY', 'New York'])
      }
    )
  })

  it('accepts a full "City, Country" on the first try without relaxing', async () => {
    await withWeatherFetch(
      {
        hits: {
          'Paris, France': [
            {
              name: 'Paris',
              admin1: 'Île-de-France Region',
              country: 'France',
              latitude: 48.8534,
              longitude: 2.3488,
            },
          ],
        },
      },
      async (calls) => {
        const result = await executeLocalTool('get_weather', { location: 'Paris, France' })
        expect(result).toMatchObject({ resolvedLocation: 'Paris, Île-de-France Region, France' })
        expect(calls.geoNames).toEqual(['Paris, France'])
      }
    )
  })

  it('honors a region hint to pick the right same-named city (Vancouver, WA)', async () => {
    await withWeatherFetch(
      {
        hits: {
          Vancouver: [
            {
              name: 'Vancouver',
              admin1: 'British Columbia',
              country: 'Canada',
              latitude: 49.2497,
              longitude: -123.1193,
            },
            {
              name: 'Vancouver',
              admin1: 'Washington',
              country: 'United States',
              latitude: 45.6318,
              longitude: -122.6718,
            },
          ],
        },
      },
      async () => {
        const result = await executeLocalTool('get_weather', { location: 'Vancouver, WA' })
        expect(result).toMatchObject({
          resolvedLocation: 'Vancouver, Washington, United States',
          latitude: 45.6318,
        })
      }
    )
  })

  it('ignores fuzzy non-matching noise Open-Meteo mixes into a name search', async () => {
    // name=Washington really does surface "Macomb, Illinois" as a top result;
    // the region-hint pass must not latch onto it just because it is in Illinois.
    await withWeatherFetch(
      {
        hits: {
          Washington: [
            {
              name: 'Washington D.C.',
              admin1: 'District of Columbia',
              country: 'United States',
              latitude: 38.8951,
              longitude: -77.0364,
            },
            {
              name: 'Macomb',
              admin1: 'Illinois',
              country: 'United States',
              latitude: 40.4592,
              longitude: -90.6718,
            },
          ],
        },
      },
      async () => {
        const result = await executeLocalTool('get_weather', { location: 'Washington, IL' })
        expect(result).toMatchObject({
          resolvedLocation: 'Washington D.C., District of Columbia, United States',
        })
        if ('resolvedLocation' in result) {
          expect(result.resolvedLocation).not.toContain('Macomb')
        }
      }
    )
  })

  it('requires every region hint to hold so a shared country cannot win (Springfield, IL, US)', async () => {
    await withWeatherFetch(
      {
        hits: {
          Springfield: [
            {
              name: 'Springfield',
              admin1: 'Missouri',
              country: 'United States',
              latitude: 37.2153,
              longitude: -93.2982,
            },
            {
              name: 'Springfield',
              admin1: 'Illinois',
              country: 'United States',
              latitude: 39.7817,
              longitude: -89.6501,
            },
          ],
        },
      },
      async () => {
        const result = await executeLocalTool('get_weather', { location: 'Springfield, IL, US' })
        // Missouri shares the "US" hint but fails "IL"; only Illinois satisfies both.
        expect(result).toMatchObject({
          resolvedLocation: 'Springfield, Illinois, United States',
          latitude: 39.7817,
        })
      }
    )
  })

  it('maps a malformed 200 body to the transient message instead of leaking internals', async () => {
    await withWeatherFetch({ raw: { Nullville: null } }, async () => {
      const result = await executeLocalTool('get_weather', { location: 'Nullville' })
      expect(result).toHaveProperty('error')
      if ('error' in result) {
        expect(result.error).toContain('unavailable')
        expect(result.error).not.toContain('is not an object')
        expect(result.error).not.toContain('results')
      }
    })
  })

  it('reports a genuine miss with honest copy that does not tell the user to retry', async () => {
    await withWeatherFetch({ hits: {} }, async () => {
      const result = await executeLocalTool('get_weather', { location: 'Asdfghjkl' })
      expect(result).toHaveProperty('error')
      if ('error' in result) {
        expect(result.error).toContain("Couldn't find weather for")
        expect(result.error).not.toContain('try again')
      }
    })
  })

  it('classifies a geocoding HTTP failure as transient and invites a retry', async () => {
    await withWeatherFetch({ status: { Tokyo: 503 } }, async () => {
      const result = await executeLocalTool('get_weather', { location: 'Tokyo' })
      expect(result).toHaveProperty('error')
      if ('error' in result) {
        expect(result.error).toContain('unavailable')
        expect(result.error).toContain('try again')
      }
    })
  })

  it('treats a forecast response missing current conditions as transient', async () => {
    await withWeatherFetch(
      {
        hits: {
          Berlin: [
            {
              name: 'Berlin',
              admin1: 'Land Berlin',
              country: 'Germany',
              latitude: 52.5244,
              longitude: 13.4105,
            },
          ],
        },
        forecast: {},
      },
      async () => {
        const result = await executeLocalTool('get_weather', { location: 'Berlin' })
        expect(result).toHaveProperty('error')
        if ('error' in result) {
          expect(result.error).toContain('try again')
        }
      }
    )
  })
})

describe('executeLocalTool coordinate validation', () => {
  it('rejects partial coordinate input', async () => {
    await expect(executeLocalTool('get_weather', { latitude: 49.2 })).resolves.toEqual({
      error: 'Latitude and longitude must be provided together.',
    })
  })

  it('rejects non-numeric coordinate input', async () => {
    await expect(
      executeLocalTool('get_weather', { latitude: 'north', longitude: -123.1 })
    ).resolves.toEqual({
      error: 'Latitude and longitude must both be valid numbers.',
    })
  })

  it('rejects out-of-range coordinates', async () => {
    await expect(
      executeLocalTool('get_weather', { latitude: 95, longitude: -123.1 })
    ).resolves.toEqual({
      error: 'Latitude must be between -90 and 90.',
    })

    await expect(
      executeLocalTool('get_weather', { latitude: 49.2, longitude: -181 })
    ).resolves.toEqual({
      error: 'Longitude must be between -180 and 180.',
    })
  })
})

describe('executeLocalTool no-location fallback', () => {
  it('asks the user for a location when neither an arg nor request geolocation is available', async () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = createMockFetch(() => {
      fetchCalls += 1
      throw new Error('fetch should not run when no location is available')
    })
    try {
      const result = await executeLocalTool('get_weather', {})
      expect(result).toEqual({
        error: 'No location was provided. Please specify a city (and state or country if helpful).',
      })
      expect(fetchCalls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('still uses Cloudflare request geolocation when no location arg is given', async () => {
    await withWeatherFetch({}, async () => {
      const result = await executeLocalTool(
        'get_weather',
        {},
        {
          requestLocation: {
            latitude: 43.6532,
            longitude: -79.3832,
            city: 'Toronto',
            region: 'Ontario',
            country: 'Canada',
          },
        }
      )
      expect(result).toMatchObject({
        source: 'request_cf',
        resolvedLocation: 'Toronto, Ontario, Canada',
      })
    })
  })
})
