import { describe, expect, it } from 'vitest'
import { auditAction, connectionName, consumerName, duration, exactTime, gameResult, openReminder, plural, predictionStatus, queueName, reminderStatus, when } from '../../apps/dashboard/src/copy.js'

describe('dashboard copy', () => {
  it('turns API codes into rioplatense labels and keeps unknown codes visible', () => {
    expect(reminderStatus('delivery_unknown')).toBe('Sin confirmar si llegó')
    expect(reminderStatus('nuevo_estado')).toBe('nuevo_estado')
    expect(openReminder('queued')).toBe(true); expect(openReminder('sent')).toBe(false)
    expect(predictionStatus('CANCELED')).toBe('Cancelada y reembolsada')
    expect(gameResult('win', false)).toBe('Victoria'); expect(gameResult('loss', false)).toBe('Derrota'); expect(gameResult('remake', false)).toBe('Remake')
    expect(gameResult(undefined, true)).toBe('En juego'); expect(gameResult(undefined, false)).toBe('Sin resultado')
    expect(queueName(420)).toBe('SoloQ'); expect(queueName(9999)).toBe('Cola 9999')
    expect(connectionName('bot')).toBe('Cuenta del bot'); expect(consumerName('channel-events')).toBe('Respuestas automáticas')
  })
  it('describes audit actions, including the prediction they touched', () => {
    expect(auditAction('settings.update')).toBe('Cambió la configuración')
    expect(auditAction('predictions.RESOLVED:LA2_1')).toBe('Resolvió la prediction LA2_1')
    expect(auditAction('custom.thing')).toBe('custom.thing')
  })
  it('formats relative and exact times, durations and plurals', () => {
    const now = Date.UTC(2026, 10, 18, 12)
    expect(when(now - 10_000, now)).toBe('recién')
    expect(when(now - 3 * 60_000, now)).toBe('hace 3 minutos')
    expect(when(now - 2 * 3_600_000, now)).toBe('hace 2 horas')
    expect(when(now - 86_400_000, now)).toBe('ayer')
    expect(when(new Date(now - 30 * 86_400_000).toISOString(), now)).toMatch(/\d/)
    expect(when('not a date', now)).toBe('not a date'); expect(exactTime('nope')).toBe('nope'); expect(exactTime(now)).toMatch(/\d/)
    expect(duration(0)).toBe('sin espera'); expect(duration(28_800)).toBe('8 h'); expect(duration(5_445)).toBe('1 h 30 min 45 s')
    expect(plural(1, 'vez', 'veces')).toBe('1 vez'); expect(plural(3, 'vez', 'veces')).toBe('3 veces')
  })
})
describe('state tones', () => {
  it('maps reminder and prediction states to visual tones', async () => {
    const { reminderTone, predictionTone } = await import('../../apps/dashboard/src/copy.js')
    expect(['delivery_unknown', 'sending', 'sent', 'canceled', 'queued'].map(reminderTone)).toEqual(['alert', 'live', 'done', 'done', 'pending'])
    expect(['ACTIVE', 'conflict', 'RESOLVED', 'skipped', 'LOCKED'].map(predictionTone)).toEqual(['live', 'alert', 'done', 'done', 'pending'])
  })
})
