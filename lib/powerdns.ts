type PowerDnsZone = {
  id: string
  name: string
  kind?: string
  url?: string
}

function getPowerDnsConfig() {
  const apiUrl = process.env.POWERDNS_API_URL
  const apiKey = process.env.POWERDNS_API_KEY
  const serverId = process.env.POWERDNS_SERVER_ID

  if (!apiUrl) {
    throw new Error('POWERDNS_API_URL is not set')
  }

  if (!apiKey) {
    throw new Error('POWERDNS_API_KEY is not set')
  }

  if (!serverId) {
    throw new Error('POWERDNS_SERVER_ID is not set')
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    apiKey,
    serverId,
  }
}

async function powerDnsRequest(path: string, init?: RequestInit) {
  const config = getPowerDnsConfig()
  const response = await fetch(`${config.apiUrl}/servers/${config.serverId}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      ...(init?.headers ?? {}),
    },
  })

  const responseText = await response.text()
  const data = responseText ? JSON.parse(responseText) : null

  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string'
        ? data.error
        : `PowerDNS request failed with status ${response.status}`,
    )
  }

  return data
}

function normalizeZoneName(name: string) {
  const trimmed = name.trim().toLowerCase()
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`
}

export async function listZones(): Promise<PowerDnsZone[]> {
  return (await powerDnsRequest('/zones')) as PowerDnsZone[]
}

export async function createZone(name: string): Promise<PowerDnsZone> {
  const normalizedName = normalizeZoneName(name)

  return (await powerDnsRequest('/zones', {
    method: 'POST',
    body: JSON.stringify({
      name: normalizedName,
      kind: 'Native',
      nameservers: [],
    }),
  })) as PowerDnsZone
}

export function normalizePowerDnsZoneName(name: string) {
  return normalizeZoneName(name)
}
