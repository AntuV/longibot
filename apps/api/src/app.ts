import 'reflect-metadata'
import { ConsoleLogger, Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { ApiOkResponse, DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { ServeStaticModule } from '@nestjs/serve-static'
import { LogController } from 'fastify'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import { installRoutes } from './routes.js'
import type { Twitch } from '../../../packages/infrastructure/src/adapters/twitch.js'
import { readConfig } from '../../../packages/core/src/config.js'

export async function createApp (options: { pool?: Pool, logging?: boolean, staticFiles?: boolean, twitch?: Twitch, onClose?: () => Promise<void> } = {}) {
  const config = readConfig()
  class HealthController {
    live () { return { status: 'ok' } }
    async ready () {
      if (!options.pool) throw new ServiceUnavailableException('Database unavailable')
      try { await options.pool.query('SELECT 1') } catch { throw new ServiceUnavailableException('Database unavailable') }
      return { status: 'ok' }
    }
  }
  Controller('health')(HealthController)
  for (const [method, path] of [['live', 'live'], ['ready', 'ready']] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(HealthController.prototype, method)!
    Get(path)(HealthController.prototype, method, descriptor)
    ApiOkResponse({ schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } } })(HealthController.prototype, method, descriptor)
  }
  class AppModule {}
  Module({
    imports: options.staticFiles === false ? [] : [ServeStaticModule.forRoot({ rootPath: resolve('apps/dashboard/dist'), serveStaticOptions: { fallthrough: true } })],
    controllers: [HealthController]
  })(AppModule)
  const adapter = new FastifyAdapter({
    logger: options.logging === false ? false : { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] },
    // OAuth codes and tokens in query strings must never enter access logs.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1_048_576
  })
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { rawBody: true, logger: options.logging === false ? false : new ConsoleLogger({ json: true }) })
  app.setGlobalPrefix('api')
  await app.register(helmet)
  await app.register(cookie)
  // ServeStaticModule's Fastify loader does not honor exclude. More-specific
  // API routes prevent unknown API URLs from falling through to the SPA.
  const server = app.getHttpAdapter().getInstance()
  if (options.onClose) server.addHook('onClose', options.onClose)
  for (const url of ['/api', '/api/*']) {
    server.all(url, async (_request, reply) => reply.code(404).send({ statusCode: 404, message: 'Not Found' }))
  }
  app.enableShutdownHooks()
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('LongiBot API').setVersion('0.1.0').build())
  server.register(async scope => { installRoutes(scope, options.pool, config.TWITCH_CHANNEL, document, options.twitch) })
  await app.init()
  await server.ready()
  return { app, document, config }
}
