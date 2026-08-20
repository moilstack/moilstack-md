# AI Configuration & Model Setup Guide

MoilStack .md supports five model connection types: the standard OpenAI Chat Completions API format, Anthropic's native Messages API, Ollama (local or Cloud), and locally installed CLI tools. This guide provides detailed instructions on configuring each[cite: 1].

> **Starter models:** Five ready-to-use configs — **Claude Haiku** (CLI), **Agy — Gemini Flash Medium** (CLI), **Anthropic Haiku**, **Ollama Local**, and **Ollama Cloud** — are added automatically the first time you launch the app (and any time one is missing), so you don't need to create these from scratch. CLI ones just need the tool installed and logged in; the API/Cloud ones just need a key pasted into **Settings → AI Models → Edit**.

---

## Cloud API Providers

To connect a cloud provider, navigate to **Settings** (⚙ gear icon) → **AI Models** → **Add Model**, choose a provider type, and input your credentials[cite: 1].

| Provider | Base URL | Free Tier Details |
|---|---|---|
| [Groq](https://console.groq.com) | `https://api.groq.com/openai/v1` | ✅ No credit card required[cite: 1] |
| [Google Gemini](https://aistudio.google.com/app/apikey) | `https://generativelanguage.googleapis.com/v1beta/openai/` | ✅ Free tier available[cite: 1] |
| [OpenRouter](https://openrouter.ai/keys) | `https://openrouter.ai/api/v1` | ✅ Free models available (append `:free`)[cite: 1] |
| [Mistral](https://console.mistral.ai) | `https://api.mistral.ai/v1` | ✅ Free tier available[cite: 1] |
| [Together AI](https://api.together.ai) | `https://api.together.xyz/v1` | ✅ $1 credit on signup[cite: 1] |
| [OpenAI](https://platform.openai.com/api-keys) | `https://api.openai.com/v1` | Paid tier only[cite: 1] |

---

## Anthropic API (Direct)

For a direct connection to Anthropic — no OpenAI-compatible shim, native Messages API — choose the **Anthropic** type when adding a model.

1. Grab an API key from [console.anthropic.com](https://console.anthropic.com).
2. In **Settings → AI Models → Add Model**, choose type **Anthropic**, leave the Base URL as the default (`https://api.anthropic.com`) unless you're using a proxy, set a Model Name (e.g. `claude-haiku-4-5`, `claude-sonnet-4-5`), and paste in your API key.

---

## Local CLI Tools (Claude CLI, Agy CLI)

Instead of talking to an API, MoilStack .md can spawn a command-line tool you already have installed and logged in on your machine, and stream its output straight into the chat. No API key is stored in the app for this type — the CLI manages its own authentication.

1. Install and log in to the CLI separately, outside MoilStack .md:
   - **Claude Code** — see [claude.com/claude-code](https://claude.com/claude-code), then run `claude` once from a terminal to complete login.
   - **Agy** — install per its own docs, then run its login/auth command once.
2. In **Settings → AI Models → Add Model**, choose type **CLI**, set Executable to `claude` or `agy` (pick from the suggestion list or type any other CLI on your PATH), optionally set a Model Name, and optionally override the advanced Flags template.
3. The Flags field supports these tokens: `{{model}}` (the Model Name field), `{{prompt}}` (the conversation text, passed as one argument), `{{prompt_file}}` (the conversation written to a temp file, for tools that expect a file path or `@file` attachment), and `{{cwd}}` (the folder currently open in the Explorer sidebar, if any).

> *Both CLI tools must already be installed and authenticated — MoilStack .md does not manage CLI login for you.*

---

## Local & Cloud Ollama Setup

For maximum data privacy, you can run large language models completely local to your machine with zero data leakage[cite: 1]. Ollama Cloud uses the same connection type, just pointed at a remote host with an API key.

### Local
1. Download and install the core framework from [ollama.com/download](https://ollama.com/download)[cite: 1].
2. Open your local terminal window and pull your preferred model[cite: 1]. We highly recommend running `ollama pull qwen2.5:7b` or `ollama pull llama3.2`[cite: 1].
3. Inside MoilStack .md, open the Settings menu, add a new model with the type set to **Ollama**, leave the API Key field blank, and click **Detect** to auto-discover your active local engines[cite: 1].

### Cloud
1. Sign up at [ollama.com](https://ollama.com) and grab an API key.
2. Add a new model with type **Ollama**, set the Base URL to `https://ollama.com` (or your cloud endpoint), paste in the API key, then click **Detect** to list available cloud models.

> *Note: Running local models under 7B parameters may yield less reliable results when processing strict inline document edits[cite: 1].*

---

## Recommended Models

| Model Name | Integration Provider | Editing Accuracy | Speed Metrics |
|---|---|---|---|
| `llama-3.3-70b-versatile` | Groq (Free) | ⭐⭐⭐⭐⭐ | Ultra Fast[cite: 1] |
| `gemini-2.0-flash` | Google (Free) | ⭐⭐⭐⭐⭐ | Exceptionally Fast[cite: 1] |
| `gpt-4o-mini` | OpenAI (Paid) | ⭐⭐⭐⭐⭐ | Fast[cite: 1] |
| `qwen2.5:7b` | Ollama (Local) | ⭐⭐⭐⭐ | Medium[cite: 1] |
| `llama3.2` | Ollama (Local) | ⭐⭐⭐ | Fast[cite: 1] |

---

## Core Provider Compatibility

| Provider Integration | Support Status | Architecture Notes |
|---|---|---|
| Groq | ✅ Fully Supported | Standard OpenAI format integration with free options[cite: 1]. |
| OpenAI | ✅ Fully Supported | Native standard compatibility[cite: 1]. |
| Together AI | ✅ Fully Supported | Native standard compatibility[cite: 1]. |
| Mistral AI | ✅ Fully Supported | Native standard compatibility[cite: 1]. |
| OpenRouter | ✅ Fully Supported | Native standard compatibility[cite: 1]. |
| Google Gemini | ✅ Fully Supported | Accessible via standard OpenAI-compatible endpoints[cite: 1]. |
| Cerebras | ✅ Fully Supported | Native standard compatibility[cite: 1]. |
| Perplexity | ✅ Fully Supported | Native standard compatibility[cite: 1]. |
| Azure OpenAI | ⚠️ Partial Support | Utilizes a unique deployment URL layout rather than global endpoints[cite: 1]. |
| Anthropic Claude (API) | ✅ Fully Supported | Native Messages API integration — its own dedicated connection type, not the OpenAI-compatible shim. |
| Claude Code (CLI) | ✅ Fully Supported | Spawned as a local subprocess; uses its own login, no API key stored in the app. |
| Agy (CLI) | ✅ Fully Supported | Spawned as a local subprocess; uses its own login, no API key stored in the app. |
| AWS Bedrock | ❌ Not Supported | Demands AWS SigV4 request signatures which are not yet supported[cite: 1]. |
| Ollama (Local) | ✅ Fully Supported | Integrated via dedicated Ollama NDJSON streaming endpoints[cite: 1]. |
| Ollama Cloud | ✅ Fully Supported | Same Ollama connection type, pointed at a remote host with an API key. |