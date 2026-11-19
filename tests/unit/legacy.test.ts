import { expect, it } from 'vitest'
import { applyLegacy, planLegacy } from '../../packages/features/src/legacy.js'
import { initialState } from '../../packages/features/src/model.js'
it('selectively imports question alternatives/rotation and verified live cooldowns, never currency or secrets', () => {
  const now = Date.now(); const until = new Date(now + 10000).toISOString()
  const plan = planLegacy({ questions: [{ id: 1, question: '?', answers: ' A; b;;', times_sent: 2 }, { id: 2, question: 'Q2', answers: 'answer' }, {}, { id: 3, question: 'Q3', answers: '; ;' }, { id: 4, question: 'Q4', answers: 'a'.repeat(201) }], cooldowns: [{ username: 'USER', command: 'historia', expiration: until }, { username: 'guest', command: 'historia-duo', expiration: until }, { username: 'unknown', command: 'historia', expiration: until }, { username: 'unknown', command: 'historia', expiration: until }, { username: 'expired', command: 'historia', expiration: new Date(now - 1000).toISOString() }, { username: 'invalid', command: 'historia', expiration: 'bad' }, { username: 'badid', command: 'historia', expiration: until }, { command: 'tts' }] }, { user: '1', guest: '2', badid: 'not-an-id' }, now)
  expect(plan.questions).toHaveLength(2); expect(plan.rejected).toBe(5); expect(plan.unresolved).toEqual(['unknown', 'badid'])
  expect(plan.cooldowns).toEqual([{ key: 'stories:actor:1', until: now + 10000 }, { key: 'stories:guest:2', until: now + 10000 }])
  const s = initialState(); s.cooldowns['stories:actor:1'] = now + 20000
  applyLegacy(s, plan); applyLegacy(s, plan)
  expect(s.questions.legacy_1?.answers).toEqual(['A', 'b']); expect(s.questions.legacy_2?.used).toBe(0)
  expect(s.cooldowns['stories:actor:1']).toBe(now + 20000); expect(s.wins).toEqual({}); expect(s.settings.trivia.enabled).toBe(false)
})
