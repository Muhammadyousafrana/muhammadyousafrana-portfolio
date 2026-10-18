import { ErrorBoundary } from '@/components/ErrorBoundary'
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary'
import { TurnstileChallengeProvider } from '@/components/TurnstileChallengeProvider'
import '@/index.css'
import '@/lib/errorReporter'
import { HomePage } from '@/pages/HomePage'
import { enableMapSet } from 'immer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
enableMapSet()

const router = createBrowserRouter([
  {
    path: '/',
    element: <HomePage />,
    errorElement: <RouteErrorBoundary />,
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <TurnstileChallengeProvider>
        <RouterProvider router={router} />
      </TurnstileChallengeProvider>
    </ErrorBoundary>
  </StrictMode>
)
