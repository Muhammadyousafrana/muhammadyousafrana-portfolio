import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import fs from 'node:fs'
import path from 'node:path'
import { API_RESPONSES } from './worker/config'
import type { Env } from './worker/core-utils'
import { withOriginPolicy } from './worker/security'
import { userRoutes } from './worker/userRoutes'

// Load local env files if present
for (const envFile of ['.env', '.env.local', '.dev.vars']) {
  const filePath = path.resolve(process.cwd(), envFile)
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim()
          const val = trimmed.slice(eqIdx + 1).trim()
          if (!process.env[key]) {
            process.env[key] = val
          }
        }
      }
    }
  }
}

const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('*', logger())

// Bind environment variables from process.env
app.use('*', async (c, next) => {
  const host = c.req.header('x-forwarded-host') || c.req.header('host')
  const proto = c.req.header('x-forwarded-proto') || 'https'
  const origin = host ? `${proto}://${host}` : undefined
  const configuredOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : []
  if (origin && !configuredOrigins.includes(origin)) {
    configuredOrigins.push(origin)
  }

  c.env = {
    ALLOWED_ORIGINS: configuredOrigins.join(','),
    AI_PROVIDER: process.env.AI_PROVIDER || 'google-ai-studio',
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    SECURITY_HMAC_SECRET:
      process.env.SECURITY_HMAC_SECRET || 'security-hmac-secret-default-key-32chars',
    REQUIRE_TURNSTILE: process.env.REQUIRE_TURNSTILE || 'false',
    SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || 'chat_tenant',
    SESSION_COOKIE_MAX_AGE_SECONDS: process.env.SESSION_COOKIE_MAX_AGE_SECONDS || '2592000',
    RATE_LIMIT_WINDOW_SECONDS: process.env.RATE_LIMIT_WINDOW_SECONDS || '60',
    CHAT_RATE_LIMIT_PER_TENANT: process.env.CHAT_RATE_LIMIT_PER_TENANT || '40',
    CHAT_RATE_LIMIT_PER_IP: process.env.CHAT_RATE_LIMIT_PER_IP || '80',
    AI_RATE_LIMIT_PER_TENANT: process.env.AI_RATE_LIMIT_PER_TENANT || '12',
    AI_RATE_LIMIT_PER_IP: process.env.AI_RATE_LIMIT_PER_IP || '24',
    MAX_CHAT_REQUEST_BYTES: process.env.MAX_CHAT_REQUEST_BYTES || '16384',
    MAX_FIT_ANALYZE_BYTES: process.env.MAX_FIT_ANALYZE_BYTES || '24576',
    MAX_CLIENT_ERROR_BYTES: process.env.MAX_CLIENT_ERROR_BYTES || '16384',
    CLIENT_ERROR_RATE_LIMIT_PER_IP: process.env.CLIENT_ERROR_RATE_LIMIT_PER_IP || '30',
    ...c.env,
  }
  await next()
})

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

// Serve static assets from dist/
app.use('/assets/*', serveStatic({ root: './dist' }))
app.use('/icon.svg', serveStatic({ root: './dist' }))
app.use('/favicon.ico', serveStatic({ root: './dist' }))

// SPA fallback: any non-API route returns dist/index.html
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ success: false, error: API_RESPONSES.NOT_FOUND }, 404)
  }
  const indexPath = path.resolve(process.cwd(), 'dist/index.html')
  if (fs.existsSync(indexPath)) {
    return c.html(fs.readFileSync(indexPath, 'utf-8'))
  }
  return c.text('Portfolio frontend not built yet. Run build first.', 404)
})

const port = Number(process.env.PORT) || 3000
console.log(`Server starting on port ${port}...`)

serve({
  fetch: app.fetch,
  port,
})
