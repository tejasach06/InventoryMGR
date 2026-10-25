# Contributing to InventoryMGR

Thank you for your interest in contributing to InventoryMGR! This guide provides instructions on how to set up your local development environment, adhere to repository conventions, and submit contributions.

## Code of Conduct

This project and everyone participating in it is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

### Prerequisites

- **Rust**: 1.98.1 (pinned in `backend-rust/rust-toolchain.toml`)
- **Node.js**: 24 LTS (pinned in `.node-version`)
- **pnpm**: 12.14.0 (for frontend packages)
- **uv**: Python package runner (>=0.12.18, for test oracle only)
- **just**: Command runner (`cargo install just` or system package)
- **Podman / Docker**: With compose support for running the local test database

### Initial Setup

```bash
git clone https://github.com/tejasach06/InventoryMGR.git
cd InventoryMGR

# Install dependencies for both frontend and backend
just setup

# Generate local environment variables
just env
```

## Development Workflow

### Running Locally

```bash
# Start backend in development mode
just api-dev

# Start frontend in development mode
just web-dev

# Start local test database container
just db-up
```

### Verification & Testing

Before submitting a pull request, ensure all gates pass cleanly:

```bash
# Run backend Rust tests
just api-test

# Run frontend unit & component tests
just web-test

# Run full project verification (backend build, tests, frontend lint & vitest)
just verify
```

## Branching & Commit Conventions

- Create a feature branch from `main`: `git checkout -b feat/your-feature-name` or `fix/your-bug-fix`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) format for commit messages:
  - `feat(scope): add new capability`
  - `fix(scope): resolve bug`
  - `refactor(scope): restructure code without changing behavior`
  - `docs(scope): update documentation`
  - `test(scope): add or improve tests`

## Pull Request Process

1. Ensure the branch is rebased on latest `main`.
2. Confirm all automated checks pass (`just verify`).
3. Fill out the [Pull Request Template](.github/pull_request_template.md) with context, rationale, and verification proof.
4. Keep PRs focused on a single logical change; avoid bundling unrelated refactors.
