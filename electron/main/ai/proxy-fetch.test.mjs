import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import test from 'node:test'

import { closeProxyConnections, createProxyFetch, normalizeProxyUrl } from './proxy-fetch.ts'

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

test('Clash 本地代理地址可省略协议', () => {
  assert.equal(normalizeProxyUrl('127.0.0.1:7890'), 'http://127.0.0.1:7890/')
  assert.equal(normalizeProxyUrl(' http://localhost:7890 '), 'http://localhost:7890/')
})

test('代理留空时保持直连', () => {
  assert.equal(normalizeProxyUrl(''), '')
  assert.equal(normalizeProxyUrl(undefined), '')
})

test('拒绝当前不支持的代理协议与缺失端口', () => {
  assert.throws(() => normalizeProxyUrl('socks5://127.0.0.1:7890'), /仅支持 HTTP\/HTTPS/)
  assert.throws(() => normalizeProxyUrl('http://127.0.0.1'), /必须包含主机和端口/)
})

test('代理 fetch 的请求实际经过 HTTP CONNECT 代理', async () => {
  const target = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('proxied')
  })
  const targetPort = await listen(target)

  let connectCount = 0
  const proxy = http.createServer()
  proxy.on('connect', (request, clientSocket, head) => {
    connectCount += 1
    const [host, port] = request.url.split(':')
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    clientSocket.on('error', () => upstream.destroy())
    upstream.on('error', () => clientSocket.destroy())
  })
  const proxyPort = await listen(proxy)

  try {
    const requestFetch = createProxyFetch(`http://127.0.0.1:${proxyPort}`)
    const response = await requestFetch(`http://127.0.0.1:${targetPort}/probe`)
    assert.equal(await response.text(), 'proxied')
    assert.equal(connectCount, 1)
  } finally {
    await closeProxyConnections()
    await close(proxy)
    await close(target)
  }
})
