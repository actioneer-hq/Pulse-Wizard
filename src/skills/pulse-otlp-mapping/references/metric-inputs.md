# Metric input coverage

The validator classifies inputs as `available`, `degraded`, `unavailable`, or `untested`.

| Output | Strongest inputs | Degraded fallback |
|---|---|---|
| response latency | caller `speech.t_end` + `tts.first_audio` | STT end for caller stop; TTS start plus reported TTFB; finally bare TTS start |
| STT lag | STT span start and end | none |
| endpointing | speech end to STT start | reported `endpointing.delay` |
| LLM TTFT | LLM start + `llm.first_token` | reported `metrics.ttft` |
| assembly | first token + earliest TTS start | reconstructed first token from reported TTFT |
| dispatch | first token + TTS request start | request start is a TTS span carrying `tts.chars` |
| TTS TTFB | TTS start + `tts.first_audio` | reported `metrics.ttfb` |
| playout | `tts.first_audio` + audio-detected agent onset | unavailable without audio |
| unattributed time | response window + correlated STT/LLM/TTS intervals | none |
| tokens per turn | `gen_ai.usage.output_tokens` | none |
| truncation rate | `tts.chars` + `tts.chars_cut` | none |
| cut reason | `tts.cut_reason` | `tts.cancelled` + `turn.interrupted` |
| transcript | `content.transcript` | none |
| agent text | `content.llm_spoken` | none |
| language/confidence | `stt.language`, `stt.confidence` | confidence may live on turn |
| model rollups | `gen_ai.request.model` on each stage | none |
| telemetry trust | `header.counters.span_dropped_events` | absent means zero |
| barge-in agreement | `bargein` events + audio | unavailable without audio |

`Available` means the strongest observable input is present. `Degraded` means Pulse can calculate a
documented fallback. `Unavailable` means the source lacks sufficient information. `Untested` means
source suggests support but no captured scenario proves it.

Audio-only metrics such as clipping, dead air, and talk ratio belong to `pulse-storage-mapping`.

