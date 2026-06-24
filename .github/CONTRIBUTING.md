# Contributing to MoilStack .md

Thank you for your interest in contributing. Please follow the process below so all changes go through proper review before reaching production.

---

## Branch Structure

```
main         ← stable, released code — never commit directly
develop      ← integration branch — all feature/fix work merges here first
feature/*    ← new features
fix/*        ← bug fixes
chore/*      ← maintenance (deps, CI, docs)
```

## Workflow

1. **Branch off `develop`** — never branch from `main`

   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**, commit with clear messages:

   ```
   feat: add export to HTML
   fix: prevent crash when folder is empty
   chore: update electron to v43
   ```

3. **Open a PR targeting `develop`** — fill in the PR template and make sure CI passes.

4. A member of `@moilstack/owners` will review and merge into `develop`.

5. **Releases** — when `develop` is stable, the owners open a PR from `develop → main`. After review and merge, a version tag (`v1.x.x`) is pushed to trigger the automated build and GitHub Release.

---

## CI

Every PR and push to `develop` or `main` runs:

- `npm test` — unit tests
- `npm run package` — Windows build (artifact uploaded for 3 days)

A release build (`--publish always`) only runs on version tags pushed to `main`.

---

## Commit Message Format

Use the conventional prefix that matches your change:

| Prefix | When to use |
|---|---|
| `feat:` | New user-visible feature |
| `fix:` | Bug fix |
| `chore:` | Maintenance (CI, deps, tooling) |
| `docs:` | Documentation only |
| `refactor:` | Code restructure with no behaviour change |

---

## Branch Protection Rules (for repo admins)

Set these in **Settings → Branches** for both `main` and `develop`:

- Require a pull request before merging
- Require at least 1 approval
- Require review from Code Owners (`CODEOWNERS`)
- Require status checks to pass (select the `Build for Windows` check)
- Do not allow bypassing the above settings
