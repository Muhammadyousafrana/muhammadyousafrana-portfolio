/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmailButton } from './EmailButton'

describe('EmailButton', () => {
  it('opens a Gmail compose draft addressed to the portfolio email', () => {
    const markup = renderToStaticMarkup(
      <EmailButton email="yousaf@example.com" label="Email Yousaf" />
    )
    expect(markup).toContain(
      'href="https://mail.google.com/mail/?view=cm&amp;fs=1&amp;to=yousaf%40example.com"'
    )
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain('Email Yousaf')
  })

  it('labels the icon-only Gmail action accessibly', () => {
    const markup = renderToStaticMarkup(
      <EmailButton email="yousaf@example.com" label="Email Yousaf" iconOnly />
    )
    expect(markup).toContain('aria-label="Email Yousaf"')
    expect(markup).toContain('title="Email Yousaf"')
  })
})
