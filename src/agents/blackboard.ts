/**
 * Shared message board — free AIs post findings and read each other.
 */
import type { AiId } from '../aiRoster'

export type BlackboardMessage = {
  from: AiId | 'system'
  to?: AiId | 'all'
  kind: 'finding' | 'question' | 'answer' | 'challenge' | 'decision'
  text: string
  data?: Record<string, unknown>
  at: number
}

export class Blackboard {
  readonly messages: BlackboardMessage[] = []

  post(
    from: BlackboardMessage['from'],
    kind: BlackboardMessage['kind'],
    text: string,
    opts?: { to?: BlackboardMessage['to']; data?: Record<string, unknown> },
  ) {
    this.messages.push({
      from,
      to: opts?.to ?? 'all',
      kind,
      text,
      data: opts?.data,
      at: Date.now(),
    })
  }

  from(agent: AiId | 'system'): BlackboardMessage[] {
    return this.messages.filter((m) => m.from === agent)
  }

  challenges(): BlackboardMessage[] {
    return this.messages.filter((m) => m.kind === 'challenge' || m.kind === 'question')
  }

  transcript(): string {
    return this.messages
      .map((m) => {
        const arrow = m.to && m.to !== 'all' ? ` → ${m.to}` : ''
        return `[${m.kind}] ${m.from}${arrow}: ${m.text}`
      })
      .join('\n')
  }
}
