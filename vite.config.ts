// Inherited project rule: treat this file as audited infrastructure and change it
// only with care. This template fork edits it deliberately to inject SEO tags from
// content (see seoIndexHtmlPlugin below); keep other machinery here intact.
// Cloudflare vite plugin commented out for Heroku / Node.js build
// import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { exec } from 'node:child_process'
import path from 'path'
import pino from 'pino'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { resumeSeo } from './shared/resume-canonical'

const logger = pino()

// Escape a content value before injecting it into HTML (both quoted attributes
// and element text). Guards against a stray quote/angle bracket in the SEO copy
// breaking the tag or injecting markup.
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

// Replace the {{SEO_*}} placeholders in index.html with the escaped SEO values
// from content/portfolio.yaml. Single source of truth (no committed generated
// index.html). Throws if any placeholder is left unreplaced so a typo can never
// silently ship a raw token.
function seoIndexHtmlPlugin(): Plugin {
  const replacements: Record<string, string> = {
    '{{SEO_TITLE}}': escapeHtml(resumeSeo.title),
    '{{SEO_DESCRIPTION}}': escapeHtml(resumeSeo.description),
    '{{SEO_OG_TITLE}}': escapeHtml(resumeSeo.ogTitle),
    '{{SEO_OG_DESCRIPTION}}': escapeHtml(resumeSeo.ogDescription),
    '{{SEO_THEME_COLOR}}': escapeHtml(resumeSeo.themeColor),
  }
  return {
    name: 'seo-index-html',
    transformIndexHtml(html: string) {
      let out = html
      for (const [token, value] of Object.entries(replacements)) {
        out = out.split(token).join(value)
      }
      const leftover = out.match(/\{\{SEO_[A-Z_]+\}\}/)
      if (leftover) {
        throw new Error(`seo-index-html: unreplaced SEO placeholder ${leftover[0]} in index.html`)
      }
      return out
    },
  }
}

const stripAnsi = (str: string) =>
  str.replace(
    // eslint-disable-next-line no-control-regex -- Allow ANSI escape stripping
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  )

const LOG_MESSAGE_BOUNDARY = /\n(?=\[[A-Z][^\]]*\])/g

const emitLog = (level: 'info' | 'warn' | 'error', rawMessage: string) => {
  const cleaned = stripAnsi(rawMessage).replace(/\r\n/g, '\n')
  const parts = cleaned
    .split(LOG_MESSAGE_BOUNDARY)
    .map((part) => part.trimEnd())
    .filter((part) => part.trim().length > 0)

  if (parts.length === 0) {
    logger[level](cleaned.trimEnd())
    return
  }

  for (const part of parts) {
    logger[level](part)
  }
}

// 3. Create the custom logger for Vite
const customLogger = {
  warnOnce: (msg: string) => emitLog('warn', msg),

  // Use Pino's methods, passing the cleaned message
  info: (msg: string) => emitLog('info', msg),
  warn: (msg: string) => emitLog('warn', msg),
  error: (msg: string) => emitLog('error', msg),
  hasErrorLogged: () => false,

  // Keep these as-is
  clearScreen: () => {},
  hasWarned: false,
}

function watchDependenciesPlugin() {
  return {
    name: 'watch-dependencies',
    configureServer(server: any) {
      const filesToWatch = [path.resolve('package.json'), path.resolve('bun.lock')]

      server.watcher.add(filesToWatch)

      server.watcher.on('change', (filePath: string) => {
        if (filesToWatch.includes(filePath)) {
          console.log(`\n Dependency file changed: ${path.basename(filePath)}. Clearing caches...`)

          exec('rm -f .eslintcache tsconfig.tsbuildinfo', (err, stdout, stderr) => {
            if (err) {
              console.error('Failed to clear caches:', stderr)
              return
            }
            console.log('Caches cleared successfully.\n')
          })
        }
      })
    },
  }
}

function reloadTriggerPlugin() {
  return {
    name: 'reload-trigger',
    configureServer(server: any) {
      const triggerFile = path.resolve('.reload-trigger')
      server.watcher.add(triggerFile)

      server.watcher.on('change', (filePath: string) => {
        if (filePath === triggerFile || filePath.endsWith('.reload-trigger')) {
          logger.info('Reload triggered via .reload-trigger')
          server.ws.send({ type: 'full-reload' })
        }
      })
    },
  }
}

function nodeApiPlugin(): Plugin {
  return {
    name: 'node-api-server',
    async configureServer(server) {
      const fs = await import('node:fs')
      const path = await import('node:path')
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

      const { Hono } = await import('hono')
      const { getRequestListener } = await import('@hono/node-server')
      const { withOriginPolicy } = await import('./worker/security')
      const { userRoutes } = await import('./worker/userRoutes')

      const app = new Hono<any>()
      app.use('*', async (c, next) => {
        c.env = {
          AI_PROVIDER: process.env.AI_PROVIDER || 'google-ai-studio',
          GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
          SECURITY_HMAC_SECRET:
            process.env.SECURITY_HMAC_SECRET || 'dev-hmac-secret-at-least-32-characters-long',
          REQUIRE_TURNSTILE: 'false',
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

      const listener = getRequestListener(app.fetch)
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url && (req.url.startsWith('/api/') || req.url === '/api')) {
          return listener(req, res)
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default ({ mode, command }: { mode: string; command: 'build' | 'serve' }) => {
  const env = loadEnv(mode, process.cwd())
  return defineConfig({
    plugins: [
      react(),
      nodeApiPlugin(),
      seoIndexHtmlPlugin(),
      watchDependenciesPlugin(),
      reloadTriggerPlugin(),
    ],
    build: {
      minify: true,
      sourcemap: true, // Emit file-based source maps so Wrangler can package them
      rollupOptions: {
        output: {
          sourcemapExcludeSources: false, // Include original source in source maps
        },
      },
    },
    customLogger: env.VITE_LOGGER_TYPE === 'json' ? customLogger : undefined,
    // Enable source maps in development too
    css: {
      devSourcemap: true,
    },
    server: {
      allowedHosts: true,
      port: Number(process.env.PORT) || 3000,
      watch: {
        awaitWriteFinish: {
          stabilityThreshold: 150,
          pollInterval: 50,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
    optimizeDeps: {
      // This is still crucial for reducing the time from when `bun run dev`
      // is executed to when the server is actually ready.
      include: ['react', 'react-dom', 'react-router-dom', 'ai', '@ai-sdk/provider-utils'],
      force: true,
    },
    // Clear cache more aggressively
    cacheDir: 'node_modules/.vite',
  })
}
