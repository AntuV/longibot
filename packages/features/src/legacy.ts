import { z } from 'zod'
import type { State } from './model.js'
const question = z.object({ id: z.union([z.string(), z.number().int()]), question: z.string().trim().min(1).max(400), answers: z.string().min(1), times_sent: z.number().int().nonnegative().nullable().optional() })
const cooldown = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,25}$/), command: z.enum(['historia', 'historia-duo']), expiration: z.string() })
export interface LegacyData { questions: unknown[], cooldowns: unknown[] }
export interface LegacyPlan { questions: { id: string, text: string, answers: string[], used: number }[], cooldowns: { key: string, until: number }[], unresolved: string[], rejected: number }
export function planLegacy (data: LegacyData, identities: Record<string, string>, now: number): LegacyPlan {
  const plan: LegacyPlan = { questions: [], cooldowns: [], unresolved: [], rejected: 0 }
  for (const value of data.questions) {
    const parsed = question.safeParse(value)
    if (!parsed.success) { plan.rejected++; continue }
    const q = parsed.data; const answers = q.answers.split(';').map(v => v.trim()).filter(Boolean)
    if (!answers.length || answers.length > 20 || answers.some(a => a.length > 200)) { plan.rejected++; continue }
    plan.questions.push({ id: `legacy_${q.id}`, text: q.question, answers, used: q.times_sent ?? 0 })
  }
  for (const value of data.cooldowns) {
    const parsed = cooldown.safeParse(value)
    if (!parsed.success) { plan.rejected++; continue }
    const c = parsed.data; const until = Date.parse(c.expiration)
    if (!Number.isFinite(until)) { plan.rejected++; continue }
    if (until <= now) continue
    const id = identities[c.username]
    if (!id || !/^\d+$/.test(id)) { plan.unresolved.push(c.username); continue }
    plan.cooldowns.push({ key: `stories:${c.command === 'historia' ? 'actor' : 'guest'}:${id}`, until })
  }
  plan.unresolved = [...new Set(plan.unresolved)]
  return plan
}
export function applyLegacy (s: State, plan: LegacyPlan) {
  for (const q of plan.questions) s.questions[q.id] ??= q
  for (const c of plan.cooldowns) s.cooldowns[c.key] = Math.max(s.cooldowns[c.key] ?? 0, c.until)
  // Never import coins, bets, config/secrets, anime, TTS blocks, or fabricated wins.
}
