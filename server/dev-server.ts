import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import healthHandler from '../api/health.ts'
import dbCheckHandler from '../api/db-check.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')

type JsonResponse = {
  statusCode: number
  payload: unknown
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

async function runHandler(
  handler: (req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => void | Promise<void>,
): Promise<JsonResponse> {
  const response: JsonResponse = { statusCode: 200, payload: {} }

  await handler(
    {},
    {
      status(code: number) {
        response.statusCode = code

        return {
          json(body: unknown) {
            response.payload = body
          },
        }
      },
    },
  )

  return response
}

function getContentType(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
  if (filePath.endsWith('.png')) return 'image/png'

  return 'application/octet-stream'
}

const server = http.createServer(async (req, res) => {
  const requestPath = req.url ?? '/'

  if (requestPath === '/api/health') {
    const response = await runHandler(healthHandler)
    sendJson(res, response.statusCode, response.payload)
    return
  }

  if (requestPath === '/api/db-check') {
    const response = await runHandler(dbCheckHandler)
    sendJson(res, response.statusCode, response.payload)
    return
  }

  const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1)
  const filePath = path.join(distDir, relativePath)
  const safePath = path.normalize(filePath)

  if (!safePath.startsWith(distDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const fallbackPath = path.join(distDir, 'index.html')
  const targetPath = existsSync(safePath) ? safePath : fallbackPath

  try {
    const fileStat = await stat(targetPath)

    if (!fileStat.isFile()) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    res.writeHead(200, { 'content-type': getContentType(targetPath) })
    createReadStream(targetPath).pipe(res)
  } catch {
    res.writeHead(500)
    res.end('Server error')
  }
})

server.listen(3000, '127.0.0.1', () => {
  console.log('Local app available at http://127.0.0.1:3000')
})
