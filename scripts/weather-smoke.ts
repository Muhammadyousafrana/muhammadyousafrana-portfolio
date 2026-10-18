#!/usr/bin/env bun
// Opt-in live smoke for the get_weather geocoding path.
//
// Drives the real, exported `executeLocalTool('get_weather', …)` end-to-end
// against the live keyless Open-Meteo geocoding + forecast APIs, over a battery
// of the realistic queries the model naturally sends ("New York, NY", "NYC",
// "London, UK", diacritics, and a deliberate miss). Prints each query's resolved
// place or honest miss, and exits non-zero if any query lands the wrong way.
//
// Kept OUT of `bun test` on purpose (it is a script, not a *.test.ts) so CI stays
// hermetic. Run it on demand:
//
//   bun run weather:smoke
//
// This is the real-world check the unit tests deliberately cannot be: the fixtures
// assert our parsing/fallback logic, this proves the actual API still behaves the
// way that logic assumes.
import process from 'node:process'
import { executeLocalTool } from '../worker/tools'

// `expect` names the exact place the query MUST resolve to (a substring of
// resolvedLocation), so a wrong-instance regression — e.g. "Vancouver, WA" silently
// resolving to BC — fails instead of passing. `miss` requires the deterministic
// not-found copy, so a transient 503 dressed up as a miss also fails.
type SmokeCase = { query: string; expect: string } | { query: string; expect: 'miss' }

const BATTERY: SmokeCase[] = [
  { query: 'New York, NY', expect: 'New York, New York' },
  { query: 'New York', expect: 'New York, New York' },
  { query: 'NYC', expect: 'New York, New York' },
  { query: 'San Francisco, CA', expect: 'San Francisco, California' },
  { query: 'Paris', expect: 'Paris, ' },
  { query: 'London, UK', expect: 'London, England, United Kingdom' },
  { query: 'Tokyo', expect: 'Tokyo, ' },
  { query: 'Zürich', expect: 'Zurich, ' },
  { query: 'Vancouver, WA', expect: 'Vancouver, Washington, United States' },
  { query: 'Toronto, ON', expect: 'Toronto, Ontario, Canada' },
  { query: 'Asdfghjkl', expect: 'miss' },
]

const run = async (): Promise<void> => {
  let failures = 0
  for (const { query, expect } of BATTERY) {
    const result = await executeLocalTool('get_weather', { location: query })
    if ('error' in result) {
      // A real miss says "Couldn't find …"; the transient copy says "unavailable".
      const ok = expect === 'miss' && result.error.includes("Couldn't find")
      failures += ok ? 0 : 1
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${query.padEnd(20)} -> ${result.error}`)
    } else {
      const resolved = result.resolvedLocation ?? result.location
      const ok = expect !== 'miss' && (resolved?.includes(expect) ?? false)
      failures += ok ? 0 : 1
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${query.padEnd(20)} -> ${resolved} ` +
          `(${result.temperature}°C, ${result.condition})` +
          (ok ? '' : `   [expected to contain "${expect}"]`)
      )
    }
  }
  console.log(
    failures === 0
      ? '\nAll live weather smoke checks passed.'
      : `\n${failures} live weather smoke check(s) failed.`
  )
  if (failures > 0) process.exit(1)
}

void run()
