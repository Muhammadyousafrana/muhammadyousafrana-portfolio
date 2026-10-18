// Making changes to this file is **STRICTLY** forbidden. Please add your routes in `userRoutes.ts` file.

import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { AppController } from './app-controller'
import { API_RESPONSES } from './config'
import { Env } from './core-utils'
import { withOriginPolicy } from './security'
import { userRoutes } from './userRoutes'
export { AppController }
export interface ClientErrorReport {
  message: string
  url: string
  userAgent: string
  timestamp: string
  stack?: string
  componentStack?: string
  errorBoundary?: boolean
  errorBoundaryProps?: Record<string, unknown>
  source?: string
  lineno?: number
  colno?: number
  error?: unknown
}

const app = new Hono<{ Bindings: Env }>()

/** DO NOT TOUCH THE CODE BELOW THIS LINE */
// Middleware
app.use('*', logger())

// Keep `/api/*` on the shared security middleware instead of reviving an inline
// CORS/origin implementation here. The previous split drifted from
// `worker/security.ts` on loopback allowance and allowed headers.
app.use('/api/*', withOriginPolicy)

userRoutes(app)

app.get('/api/health', (c) =>
  c.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    },
  })
)

app.post('/api/client-errors', async (c) => {
  try {
    const errorReport = await c.req.json<ClientErrorReport>()
    console.error('[CLIENT ERROR]', {
      ...errorReport,
    })
    return c.json({ success: true })
  } catch (error) {
    console.error('[CLIENT ERROR HANDLER] Failed:', error)
    return c.json(
      {
        success: false,
        error: 'Failed to process error report',
      },
      { status: 500 }
    )
  }
})

app.notFound((c) =>
  c.json(
    {
      success: false,
      error: API_RESPONSES.NOT_FOUND,
    },
    { status: 404 }
  )
)

export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
