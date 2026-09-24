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
import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm';
import type { WireMessage, WireRequest } from './types.js';
/**
 * Serialize the conversation. Each message maps to one wire message in
 * order: system, developer (refused), user, assistant, tool. The
 * implementation reads `message.content` defensively so a RequestUserInput
 * (no id, no source) round-trips through the same path as a durable
 * user-role message.
 * @param messages - the harness conversation, in order.
 * @returns the wire messages; order preserved.
 */
export declare function serializeMessages(messages: readonly RequestMessage[]): WireMessage[];
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
export declare function serializeRequest(options: GenerateOptions): WireRequest;
