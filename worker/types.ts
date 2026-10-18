export interface WeatherResult {
  location: string
  temperature: number
  condition: string
  humidity: number
  latitude?: number
  longitude?: number
  resolvedLocation?: string
  timezone?: string
  source?: 'coordinates' | 'location' | 'request_cf'
}

export interface ErrorResult {
  error: string
}
