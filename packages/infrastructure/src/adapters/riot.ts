import { z } from 'zod'
import type { Account, Game } from '../../../features/src/model.js'
import { DomainError } from '../../../features/src/model.js'
import { Http, ProviderError } from './http.js'
const participant = z.object({ puuid: z.string(), championId: z.number(), riotId: z.string().optional(), summonerName: z.string().optional() })
const spectator = z.object({ gameId: z.number(), gameStartTime: z.number(), gameQueueConfigId: z.number(), participants: z.array(participant) })
const matchSchema = z.object({ metadata: z.object({ matchId: z.string() }), info: z.object({ gameEndTimestamp: z.number().optional(), gameStartTimestamp: z.number(), gameDuration: z.number(), queueId: z.number(), participants: z.array(z.object({ puuid: z.string(), championId: z.number(), win: z.boolean(), gameEndedInEarlySurrender: z.boolean().optional() })) }) })
export class Riot {
  private budget: number[] = []
  private champions: { at: number, data: Record<string, { id: string, key: string, name: string }> } | undefined
  constructor (readonly apiKey: string, readonly http = new Http()) {}
  async request (host: string, path: string) {
    const now = Date.now()
    this.budget = this.budget.filter(t => now - t < 120_000)
    // Conservative global budget shared by polling and !lol.
    if (this.budget.length >= 90 || this.budget.filter(t => now - t < 1000).length >= 18) throw new ProviderError(429, 1000)
    if (!this.apiKey) throw new DomainError('Falta RIOT_API_KEY', 503)
    this.budget.push(now)
    return this.http.request(`https://${host}.api.riotgames.com${path}`, { headers: { 'X-Riot-Token': this.apiKey } })
  }

  async resolve (gameName: string, tagLine: string, platform: Account['platform'], region: Account['region']): Promise<Account> {
    const expected = ['kr', 'jp1'].includes(platform) ? 'asia' : ['ph2', 'sg2', 'th2', 'tw2', 'vn2', 'oc1'].includes(platform) ? 'sea' : ['la1', 'la2', 'na1', 'br1'].includes(platform) ? 'americas' : 'europe'
    if (region !== expected) throw new DomainError(`La plataforma ${platform} requiere routing ${expected}`)
    const data = z.object({ puuid: z.string(), gameName: z.string(), tagLine: z.string() }).parse(await this.request(region, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`))
    return { ...data, platform, region }
  }

  async active (a: Account) {
    try { return spectator.parse(await this.request(a.platform, `/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(a.puuid)}`)) } catch (e) { if (e instanceof ProviderError && e.status === 404) return null; throw e }
  }

  async result (a: Account, gameId: string) {
    try { return matchSchema.parse(await this.request(a.region, `/lol/match/v5/matches/${encodeURIComponent(gameId)}`)) } catch (e) { if (e instanceof ProviderError && e.status === 404) return null; throw e }
  }

  async poll (a: Account, now: number): Promise<Omit<Game, 'historic'> | null> {
    const active = await this.active(a)
    if (!active) return null
    return { id: `${a.platform.toUpperCase()}_${active.gameId}`, startedAt: active.gameStartTime > 0 ? active.gameStartTime : null, observedAt: now, queue: active.gameQueueConfigId }
  }

  async history (a: Account, queue?: number, startTime?: number) {
    return z.array(z.string()).parse(await this.request(a.region, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(a.puuid)}/ids?count=20${queue ? `&queue=${queue}` : ''}${startTime ? `&startTime=${Math.floor(startTime / 1000)}` : ''}`))
  }

  async championCatalog () {
    if (this.champions && Date.now() - this.champions.at < 86400_000) return this.champions.data
    const versions = z.array(z.string()).min(1).parse(await this.http.request('https://ddragon.leagueoflegends.com/api/versions.json'))
    const data = z.object({ data: z.record(z.string(), z.object({ id: z.string(), key: z.string(), name: z.string() })) }).parse(await this.http.request(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/es_ES/champion.json`))
    this.champions = { at: Date.now(), data: data.data }
    return data.data
  }

  async lol (a: Account, query: string) {
    if (!query.trim()) return 'Usá !lol <campeón>.'
    const active = await this.active(a)
    if (!active || active.gameQueueConfigId !== 420) return 'La cuenta no está en una partida SoloQ.'
    const catalog = Object.values(await this.championCatalog())
    const key = query.trim().toLowerCase().replaceAll(' ', '')
    const matches = catalog.filter(c => [c.name, c.id].some(v => v.toLowerCase().replaceAll(' ', '').includes(key)))
    if (matches.length !== 1) return 'Campeón inexistente o ambiguo; escribí el nombre completo.'
    const champion = matches[0]!
    const player = active.participants.find(p => p.championId === Number(champion.key))
    if (!player) return 'Ese campeón no está en esta partida.'
    const account = { ...a, puuid: player.puuid }
    const ids = await this.history(account, 420)
    const games = []
    // Sequential requests deliberately respect the shared Riot budget.
    for (const id of ids) { const match = await this.result(account, id); const p = match?.info.participants.find(p => p.puuid === player.puuid && p.championId === player.championId); if (p) games.push(p) }
    const ranked = z.array(z.object({ queueType: z.string(), tier: z.string(), rank: z.string(), leaguePoints: z.number(), wins: z.number(), losses: z.number() })).parse(await this.request(a.platform, `/lol/league/v4/entries/by-puuid/${encodeURIComponent(player.puuid)}`)).find(r => r.queueType === 'RANKED_SOLO_5x5')
    const summary = games.length ? `${games.filter(g => g.win).length}/${games.length} victorias recientes con ${champion.name}` : `Sin historial reciente con ${champion.name}`
    return `${player.riotId ?? player.summonerName ?? champion.name}: ${ranked ? `${ranked.tier} ${ranked.rank}, ${ranked.leaguePoints} LP, ${ranked.wins}W/${ranked.losses}L (${Math.round(ranked.wins / Math.max(1, ranked.wins + ranked.losses) * 100)}%)` : 'sin rango SoloQ'}. ${summary}.`
  }
}
export function matchResult (match: NonNullable<Awaited<ReturnType<Riot['result']>>>, puuid: string) {
  const p = match.info.participants.find(p => p.puuid === puuid)
  if (!p) return null
  // Early-surrender flag is Riot's explicit remake signal. Never infer from
  // Spectator disappearance or award a winner for an ambiguous short game.
  if (p.gameEndedInEarlySurrender) return 'remake' as const
  if (match.info.gameDuration < 300) return null
  return p.win ? 'win' as const : 'loss' as const
}
