-- LLM health: one row per call made through the shared Anthropic client (src/services/llmMonitor.js).
-- Never stores prompts, completions or user ids: only outcome, timing, model and token counts.
-- RLS is on with no policies, so only the backend's service role can read or write it.
create table if not exists public.llm_calls (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  source text not null default 'live' check (source in ('live', 'probe')),
  model text,
  ok boolean not null,
  status integer,            -- HTTP status from the provider when it failed (429, 529, 401 ...)
  error_type text,           -- provider error type, e.g. overloaded_error, rate_limit_error, or a client error name
  error_message text,        -- first 200 characters only
  latency_ms integer,
  input_tokens integer,
  output_tokens integer
);
create index if not exists llm_calls_ts_idx on public.llm_calls (ts desc);
alter table public.llm_calls enable row level security;
