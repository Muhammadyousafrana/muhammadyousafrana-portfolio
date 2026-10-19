/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProfileLinks } from './ProfileLinks'

describe('ProfileLinks', () => {
  it('renders each profile as an external link with a visible brand mark', () => {
    const markup = renderToStaticMarkup(
      <ProfileLinks
        profiles={[
          { label: 'LinkedIn', url: 'https://linkedin.com/in/example' },
          { label: 'GitHub', url: 'https://github.com/example' },
          { label: 'Kaggle', url: 'https://kaggle.com/example' },
          { label: 'Hugging Face', url: 'https://huggingface.co/example' },
          { label: 'Credly', url: 'https://credly.com/users/example' },
          { label: 'Google Developer', url: 'https://developers.google.com/profile/example' },
        ]}
      />
    )

    for (const label of [
      'LinkedIn',
      'GitHub',
      'Kaggle',
      'Hugging Face',
      'Credly',
      'Google Developer',
    ]) {
      expect(markup).toContain(label)
    }
    expect(markup.match(/<svg/g)).toHaveLength(6)
    expect(markup.match(/target="_blank"/g)).toHaveLength(6)
  })
})
