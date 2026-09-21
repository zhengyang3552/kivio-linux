# Video input

Kivio's built-in Agent and Chat runtimes accept local video attachments through
the existing file picker, drag-and-drop and file paste workflows. Video is a
separate model capability from image input.

- Video eligibility is determined by the selected model's **Video Input** capability,
  independent of provider identity, endpoint, API format, or API-key/OAuth authentication.
  The current OpenAI Chat and Gemini adapters serialize video data; Responses and
  Anthropic adapters report an unimplemented video transport explicitly.
- Enable **Video Input** in the model details. Known supported Gemini and Kimi
  models have defaults; fetching the Kimi model catalog also imports
  `supports_video_in`. Existing explicit capability overrides take precedence.
- **Settings > Mixer > Video analysis model > Off** disables auxiliary video
  analysis. Off is the first dropdown option; it prevents auxiliary calls and preserves the model
  selection and saved reports. A capable main model always receives videos
  directly, even with an explicit auxiliary selection. Auto picks an enabled,
  credentialed model with video input; an explicit selection takes priority over
  auto candidates and is validated when the agent requests analysis. With no available model, the chat
  reports how to configure one instead of silently dropping the video.
- Auxiliary analysis defaults to a detailed chronological breakdown, including
  visible changes, readable text, presentation structure and uncertainties.
  Broad requests do not reduce this intermediate record to a short synopsis;
  explicit requests for brevity are handled in the main model's final answer.
  Analysis requests allow up to 16,384 output tokens, capped by known model limits.
  The expanded video analysis step retains the complete returned report.
- Attaching or ordinarily sending a video **does not start Mixer analysis**.
  The main agent receives attachment metadata and a `mixer_video_analysis` tool
  when a suitable auxiliary model is available. It decides whether the current
  question needs video understanding, calls the tool, and answers from its result.
  There is no composer selector, analysis button, or video slash command.
  The tool is available in both built-in Agent and Chat, including Plan, without
  a separate approval prompt. External CLI attachment handling is unchanged.
- Ordinary tool calls reuse a complete cached report. The agent can request
  `refresh: true` when existing observations cannot answer the question or the
  user asks for another analysis. Duplicate calls within a reply share a result.
- Completed reports are stored with the assistant's video-analysis tool record,
  including the originating request and video identities. Ordinary follow-ups
  reuse these reports after reloading the conversation, without an auxiliary
  call or reading/encoding the raw video files. Newly added videos do not trigger
  analysis or inherit another video's report. Cleared, summarized, removed, or
  replaced videos are excluded from cached observations. Regenerating a reply
  deletes that reply's records; use an ordinary follow-up to retain its report.
- With an unsupported main model, videos without saved observations are marked
  as not analyzed; the model must not invent their contents. Disabling analysis removes
  the tool from the main agent and also blocks execution if settings change mid-run. Tool failures are returned to the main agent; cancelling the reply interrupts analysis. Original attachments remain unchanged.
- Send a video and a question. The video card opens the local file in its default
  application. External CLI agents continue receiving file paths rather than
  native video content.
- Supported extensions: mp4, mpeg, mpg, mov, avi, flv, webm, wmv, 3gp, 3gpp.
- Active context may contain at most 14 MiB of raw video; the final JSON request
  may not exceed 20 MB (20,000,000 bytes). Base64 expansion, images, prompts and tools all count
  toward the request limit. Trim videos or clear context when needed.
- Native video requests and agent-invoked analysis reload videos from conversation storage.
  Cleared or summarized history is excluded. Missing files produce an error.
- Unsupported models and unimplemented video transports must fail explicitly, without sending video
  bytes as image or text content.
- Persisted transcripts externalize video bytes; estimates and summaries do not
  treat base64 as text tokens. Request debugging omits video bytes.

This version sends inline video data. Files API uploads, remote URLs, YouTube
links and user-controlled frame sampling are not part of this implementation.

Protocol references:

- Catalog defaults include Kimi K2.7 Code / Code HighSpeed. The official
  [K2.7 Code model card](https://huggingface.co/moonshotai/Kimi-K2.7-Code)
  documents video input. These defaults also apply when a relay lists IDs only.
- The legacy `gemini-3-pro-preview` ID retains video metadata for imported
  configurations, as documented in its
  [model card](https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-preview).
  Google has retired that endpoint; metadata recognition does not restore it.
  Explicit user overrides and advertised provider capabilities still take priority.

- [Kimi Chat Completions](https://platform.kimi.ai/docs/api/chat):
  `content[].video_url.url = data:video/mp4;base64,...`.
- [Kimi model capabilities](https://platform.kimi.ai/docs/api/list-models):
  `supports_video_in`.
- [Gemini video understanding](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding):
  `contents[].parts[].inlineData` with a video MIME type.

The local limits are deliberately conservative application limits, not claims
about the maximum size accepted by every provider or relay.

The Gemini adapter sends MOV as `video/quicktime`; stored attachments and Chat
data URLs keep their existing MIME. See the [official API audit](research/video-input-api-audit-2026-09-12.md)
for other suppliers, protocol differences and unsupported transport paths.
