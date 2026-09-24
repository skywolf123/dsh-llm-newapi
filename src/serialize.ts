/**
 * Serialize harness messages into gateway chat completions. User text is
 * joined; assistant text becomes `content`, tool calls become `tool_calls`,
 * and tool results become separate `{role: 'tool'}` messages carrying the
 * call id the harness already recorded (`message.toolCallId` on a
 * first-class tool-role message, not a block). Assistant reasoning is
 * replayed as `reasoning_content` only on tool-call turns, as required by
 * DeepSeek-family upstreams (other OpenAI-compatible upstreams ignore the
 * field). Core image blocks are rejected explicitly because this wire route
 * is text-only. Developer-role history is refused loudly: the harness
 * reserves it for Session V4 tool-addition / tool-removal persistence and the
 * OpenAI-compatible wire carries neither — until the producer and consumer
 * land together the request cannot include these blocks (matches
 * `llm-pi-ai`'s and `llm-deepseek`'s posture on the 0.1.7 seam). Deferred
 * tool loading (`ToolSchema.deferLoading`) is also unsupported: an
 * OpenAI-compatible gateway cannot honour deferred tool materialisation, so
 * we refuse the request rather than silently embed a tool that the harness
 * expected to be absent. No reasoning-control fields are emitted: the
 * adapter declares no reasoning efforts, so callers cannot pass one.
 * @module dsh-llm-newapi/serialize
 */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, RequestMessage, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { WireMessage, WireRequest, WireTool } from './types.ts'

/** Join the text blocks of a message (used for user/tool content). */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Reject core image content before any text-flattening path can silently erase it. */
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The NewAPI chat-completions adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

/** Throw a clear LlmError naming what the chat-completions wire cannot carry. */
function unsupported(reason: string): never {
  throw new LlmError(`The NewAPI chat-completions adapter does not support ${reason}.`, 'UNSUPPORTED_CONTENT')
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Extract<RequestMessage, { role: 'assistant' }>): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns: some
    // gateways reject null outright. Reasoning-ONLY turns (the model can
    // answer entirely in the reasoning channel): the wire API rejects
    // null-content/no-tool_calls assistant messages with a 400, and since
    // the message sits durably in the session log, a null here bricks every
    // later turn of that session.
    content: text,
    // DeepSeek-family upstream passback rule: reasoning_content must return
    // on tool-call turns; it is ignored on plain turns, so we drop it there
    // to save tokens.
    ...toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/** Serialize one tool-result message (0.1.7 first-class tool role). */
function serializeToolResult(message: ToolResultMessage): WireMessage {
  return {
    role: 'tool',
    tool_call_id: message.toolCallId,
    // Empty tool output still needs SOME content on the wire.
    content: flattenText(message.content) || '(no output)',
  }
}

/**
 * Serialize the conversation. Each message maps to one wire message in
 * order: system, developer (refused), user, assistant, tool. The
 * implementation reads `message.content` defensively so a RequestUserInput
 * (no id, no source) round-trips through the same path as a durable
 * user-role message.
 * @param messages - the harness conversation, in order.
 * @returns the wire messages; order preserved.
 */
export function serializeMessages(messages: readonly RequestMessage[]): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'developer') {
      // Developer history is reserved for Session V4 tool-addition /
      // tool-removal persistence; the chat-completions wire cannot carry
      // either block type. Refuse so the loop accepts neither sets of
      // blocks outside developer messages.
      unsupported('developer messages (reserved for Session V4 tool changes)')
    }
    if (message.content.some(block => block.type === 'tool-addition' || block.type === 'tool-removal')) {
      unsupported('tool-addition / tool-removal blocks (reserved for Session V4)')
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    if (message.role === 'tool') {
      wire.push(serializeToolResult(message))
      continue
    }
    // user role (and identity-free RequestUserInput share the same shape):
    // text only; the harness emits tool results as their own role:'tool'
    // messages, not as user blocks.
    wire.push({ role: 'user', content: flattenText(message.content) })
  }
  return wire
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * upstream defaults apply — including `max_tokens`, which this adapter has
 * no default for (heterogeneous upstreams each own their cap). An explicit
 * reasoning effort rides as OpenAI-compatible `reasoning_effort`; it only
 * ever arrives for a row whose catalog declares supported efforts.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @returns the chat-completions request body.
 */
export function serializeRequest(options: GenerateOptions): WireRequest {
  if (options.tools?.some(tool => tool.deferLoading === true)) {
    unsupported('deferred tool loading')
  }
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.reasoningEffort !== undefined ? { reasoning_effort: options.reasoningEffort } : {},
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}