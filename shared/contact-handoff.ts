const OPTIONAL_CONTACT_DETAIL_PLACEHOLDER_PATTERNS = [
  /^optional .+ not provided$/i,
  /^not provided$/i,
  /^n\/a$/i,
  /^none$/i,
  /^unknown$/i,
] as const

const PHONE_E164_PATTERN = /^\+[1-9]\d{7,14}$/
const stripCommonPhoneFormatting = (value: string): string => value.replace(/[\s().-]/g, '')

export const isStrictE164Phone = (value: string): boolean => PHONE_E164_PATTERN.test(value)

export const normalizeStrictE164Phone = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed || !trimmed.startsWith('+')) {
    return null
  }

  const compact = stripCommonPhoneFormatting(trimmed)
  return isStrictE164Phone(compact) ? compact : null
}

export const sanitizeOptionalContactDetail = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value
    .trim()
    .replace(/[.,:;]+$/, '')
    .trim()
  if (!normalized) {
    return undefined
  }

  if (OPTIONAL_CONTACT_DETAIL_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return undefined
  }

  return normalized
}

export const normalizeContactPhoneInput = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith('+')) {
    return normalizeStrictE164Phone(trimmed)
  }

  const compact = stripCommonPhoneFormatting(trimmed)
  const digits = compact.replace(/\D/g, '')
  if (digits.length === 10) {
    return `+1${digits}`
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }

  return null
}

export const formatContactPhoneForDisplay = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = normalizeContactPhoneInput(value)
  if (!normalized) {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const digits = normalized.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`
  }

  return normalized
}

type BuildContactRelayMessageInput = {
  contactPhone: string
  contactMessage?: string
  contactName?: string
  contactCompany?: string
}

export const buildContactRelayMessage = ({
  contactPhone,
  contactMessage,
  contactName,
  contactCompany,
}: BuildContactRelayMessageInput): string => {
  const normalizedMessage = typeof contactMessage === 'string' ? contactMessage.trim() : ''
  if (normalizedMessage) {
    return normalizedMessage
  }

  const name = sanitizeOptionalContactDetail(contactName)
  const company = sanitizeOptionalContactDetail(contactCompany)
  const contactPhoneDisplay = formatContactPhoneForDisplay(contactPhone) ?? contactPhone
  const contactIdentity = [name, company ? `from ${company}` : undefined]
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .join(' ')

  if (contactIdentity) {
    return `${contactIdentity} would like to connect with you. Callback phone: ${contactPhoneDisplay}.`
  }

  return `Someone would like to connect with you. Callback phone: ${contactPhoneDisplay}.`
}
