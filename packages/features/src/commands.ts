import type { Actor, State } from './model.js'
export interface CommandContext { state: State, actor: Actor, id: string, args: string[], at: number, random: number, guest?: Actor | undefined }
export type Command = (context: CommandContext) => void
