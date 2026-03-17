import { PrismaClient } from '@prisma/client'

declare global {
  var __prisma: PrismaClient | undefined
}

function getPrismaClient(): PrismaClient {
  if (global.__prisma) return global.__prisma
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
  if (process.env.NODE_ENV !== 'production') {
    global.__prisma = client
  }
  return client
}

// Lazy proxy — only instantiates PrismaClient when first method is called
const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient()
    const value = (client as any)[prop]
    if (typeof value === 'function') return value.bind(client)
    return value
  },
})

export default prisma
export { prisma }
