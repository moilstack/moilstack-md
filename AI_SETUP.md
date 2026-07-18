# AI Configuration & Model Setup Guide

MoilStack .md uses the standard OpenAI Chat Completions API format for its AI capabilities. This guide provides detailed instructions on configuring both cloud infrastructure and local offline models[cite: 1].

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

## Local Ollama Setup (Fully Private)

For maximum data privacy, you can run large language models completely local to your machine with zero data leakage[cite: 1].

1. Download and install the core framework from [ollama.com/download](https://ollama.com/download)[cite: 1].
2. Open your local terminal window and pull your preferred model[cite: 1]. We highly recommend running `ollama pull qwen2.5:7b` or `ollama pull llama3.2`[cite: 1].
3. Inside MoilStack .md, open the Settings menu, add a new model with the type set to **Ollama**, and click **Detect** to auto-discover your active local engines[cite: 1].

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
| Anthropic Claude | ❌ Not Supported | Relies on a non-standard API structure that is not yet supported[cite: 1]. |
| AWS Bedrock | ❌ Not Supported | Demands AWS SigV4 request signatures which are not yet supported[cite: 1]. |
| Ollama | ✅ Fully Supported | Integrated via dedicated Ollama NDJSON streaming endpoints[cite: 1]. |