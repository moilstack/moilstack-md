# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities privately via **GitHub's built-in security advisory tool**:

1. Go to the [Security tab](../../security/advisories/new) of this repository
2. Click **"Report a vulnerability"**
3. Fill in the details — what you found, steps to reproduce, and potential impact

You will receive a response within **5 business days**. If the vulnerability is confirmed, a fix will be prioritised and a patched release will be published before any public disclosure.

---

## Security Model

MoilStack .md handles AI provider API keys entered by the user. Here is how they are protected:

| What | How |
|---|---|
| API keys at rest | Encrypted with Electron `safeStorage` (OS keychain — Windows Credential Manager, macOS Keychain, Linux libsecret) |
| API keys in storage | Stored as encrypted `.bin` files in the OS user-data directory — never written to the JSON config file |
| API keys in source | No API keys are hardcoded anywhere in the source code |
| Network requests | Keys are sent only to the provider endpoint the user explicitly configured |
| Local files | The app reads and writes only files the user explicitly opens via folder picker or file dialog |

---

## Scope

Reports are welcome for vulnerabilities in:

- The Electron main process (`src/main/`)
- The preload context bridge (`src/preload/`)
- The renderer process (`src/renderer/`)
- The build and release workflow (`.github/workflows/`)

Out of scope:
- Vulnerabilities in third-party AI providers (report to the provider directly)
- Issues requiring physical access to the user's machine
- Social engineering attacks
