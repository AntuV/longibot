import type { Actor, State } from './model.js'
export interface CommandContext { state: State, actor: Actor, id: string, text: string, args: string[], at: number, random: number, guest?: Actor | undefined, replyTo?: string | undefined }
export type Command = (context: CommandContext) => void
