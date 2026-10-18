export const createMockFetch = (
  implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
  baseFetch: typeof fetch = globalThis.fetch
): typeof fetch =>
  Object.assign((...args: Parameters<typeof fetch>) => implementation(...args), {
    preconnect: baseFetch.preconnect,
  })
