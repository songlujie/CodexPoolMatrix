# Contributing

This repository uses a simple three-layer Git workflow:

```text
feature/* -> develop -> main
```

## Branches

- `main`: stable, releasable code only
- `develop`: day-to-day integration branch
- `feature/*`: personal working branches for features, fixes, and refactors

Do not develop directly on `main`.

## Daily Workflow

### 1. Sync `develop`

```bash
git checkout develop
git pull origin develop
```

### 2. Create a working branch

Examples:

```bash
git checkout -b feature/add-openclaw-panel
git checkout -b fix/account-auto-refresh
git checkout -b refactor/account-card-split
```

### 3. Commit and push

```bash
git add .
git commit -m "Add OpenClaw settings panel"
git push -u origin feature/add-openclaw-panel
```

### 4. Open a pull request

- Open PR from `feature/*` to `develop`
- After `develop` is verified, open PR from `develop` to `main`

## Branch Protection

- `main` is protected and should only be updated through pull requests
- Collaborators should push to `develop` or `feature/*` branches instead of pushing to `main`

## Recommended PR Scope

- Keep PRs focused on one feature or one fix
- Avoid mixing refactors, UI changes, and unrelated bug fixes in one PR
- Rebase or merge the latest `develop` before opening or merging a PR if needed

## Helpful Commands

Create local `develop` from remote:

```bash
git fetch origin
git checkout -b develop origin/develop
```

Update an older feature branch:

```bash
git checkout develop
git pull origin develop
git checkout feature/your-branch
git merge develop
```

## Before Opening a PR

Run the local checks:

```bash
npm run lint
npm test
npm run build
```
