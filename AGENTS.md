---
description: Instructions building apps with MCP
globs: *
alwaysApply: true
---

# InboxPilot Project Guide

## Project Overview
InboxPilot is a multi-tenant AI customer support platform. See `docs/` for comprehensive documentation.

## Key Documentation
- `docs/ARCHITECTURE.md` — System architecture, data flows, design decisions
- `docs/DATABASE.md` — Schema reference, RLS policies, migrations
- `docs/API.md` — All 14 serverless function endpoints
- `docs/DEVELOPMENT.md` — Local setup, adding features, conventions
- `docs/TESTING.md` — Testing strategy, correctness properties

## Critical Rules for This Project
1. **Portability**: Business logic in `packages/support-core/` MUST NOT import `@insforge/sdk` or any InsForge-specific code. All external dependencies are injected via interfaces.
2. **SDK Usage**: Frontend code uses `@insforge/sdk` via `lib/insforge.ts`. Use `insforge.database.from()` chainable API, NOT raw fetch.
3. **Auth**: Use `insforge.auth.signUp()`, `insforge.auth.signInWithPassword()`, `insforge.auth.getCurrentUser()`, `insforge.auth.signOut()`.
4. **Database Queries**: Use `insforge.database.from('table').select().eq().order()` pattern. See `docs/DEVELOPMENT.md` for examples.
5. **Tailwind CSS**: Use v3.4 only. Do NOT upgrade to v4.
6. **Testing**: All new business logic needs property-based tests (fast-check). See `docs/TESTING.md`.
7. **Audit Logging**: All significant actions must be logged to `audit_logs` table.
8. **RLS**: All tenant-scoped tables have Row Level Security. Never bypass RLS from client code.

## Project Structure Quick Reference
- `app/` — Next.js pages (login, register, inbox, knowledge, analytics, settings)
- `components/inbox/` — Inbox UI components
- `lib/` — InsForge client, auth context, realtime hook
- `packages/support-core/src/` — Portable business logic
  - `adapters/` — SMS/email provider adapters
  - `interfaces/` — TypeScript interfaces (DatabaseClient, JobQueue, etc.)
  - `repositories/` — Data access layer (13 repositories)
  - `services/` — Business logic (InboundMessage, OutboundMessage, AiAgent, etc.)
  - `types/` — Shared type definitions
  - `utils/` — Normalization, chunking utilities
- `insforge/functions/` — 14 serverless function entrypoints
- `insforge/migrations/` — SQL migration files

---

# InsForge SDK Documentation - Overview

## What is InsForge?

Backend-as-a-service (BaaS) platform providing:

- **Database**: PostgreSQL with PostgREST API
- **Authentication**: Email/password + OAuth (Google, GitHub)
- **Storage**: File upload/download
- **AI**: Chat completions and image generation (OpenAI-compatible)
- **Functions**: Serverless function deployment
- **Realtime**: WebSocket pub/sub (database + client events)

## Installation

The following is a step-by-step guide to installing and using the InsForge TypeScript SDK for Web applications. If you are building other types of applications, please refer to:
- [Swift SDK documentation](/sdks/swift/overview) for iOS, macOS, tvOS, and watchOS applications.
- [Kotlin SDK documentation](/sdks/kotlin/overview) for Android applications.
- [REST API documentation](/sdks/rest/overview) for direct HTTP API access.

### 🚨 CRITICAL: Follow these steps in order

### Step 1: Download Template

Use the `download-template` MCP tool to create a new project with your backend URL and anon key pre-configured.

### Step 2: Install SDK

```bash
npm install @insforge/sdk@latest
```

### Step 3: Create SDK Client

You must create a client instance using `createClient()` with your base URL and anon key:

```javascript
import { createClient } from '@insforge/sdk';

const client = createClient({
  baseUrl: 'https://your-app.region.insforge.app',  // Your InsForge backend URL
  anonKey: 'your-anon-key-here'       // Get this from backend metadata
});

```

**API BASE URL**: Your API base URL is `https://your-app.region.insforge.app`.

## Getting Detailed Documentation

### 🚨 CRITICAL: Always Fetch Documentation Before Writing Code

InsForge provides official SDKs and REST APIs, use them to interact with InsForge services from your application code.

- [TypeScript SDK](/sdks/typescript/overview) - JavaScript/TypeScript
- [Swift SDK](/sdks/swift/overview) - iOS, macOS, tvOS, and watchOS
- [Kotlin SDK](/sdks/kotlin/overview) - Android and Kotlin Multiplatform
- [REST API](/sdks/rest/overview) - Direct HTTP API access

Before writing or editing any InsForge integration code, you **MUST** call the `fetch-docs` or `fetch-sdk-docs` MCP tool to get the latest SDK documentation. This ensures you have accurate, up-to-date implementation patterns.

### Use the InsForge `fetch-docs` MCP tool to get specific SDK documentation:

Available documentation types:

- `"instructions"` - Essential backend setup (START HERE)
- `"real-time"` - Real-time pub/sub (database + client events) via WebSockets
- `"db-sdk-typescript"` - Database operations with TypeScript SDK
- **Authentication** - Choose based on implementation:
  - `"auth-sdk-typescript"` - TypeScript SDK methods for custom auth flows
  - `"auth-components-react"` - Pre-built auth UI for React+Vite (singlepage App)
  - `"auth-components-react-router"` - Pre-built auth UI for React(Vite+React Router) (Multipage App)
  - `"auth-components-nextjs"` - Pre-built auth UI for Nextjs (SSR App)
- `"storage-sdk"` - File storage operations
- `"functions-sdk"` - Serverless functions invocation
- `"ai-integration-sdk"` - AI chat and image generation
- `"real-time"` - Real-time pub/sub (database + client events) via WebSockets
- `"deployment"` - Deploy frontend applications via MCP tool

These documentations are mostly for TypeScript SDK. For other languages, you can also use `fetch-sdk-docs` mcp tool to get specific documentation.

### Use the InsForge `fetch-sdk-docs` MCP tool to get specific SDK documentation

You can fetch sdk documentation using the `fetch-sdk-docs` MCP tool with specific feature type and language.

Available feature types:
- db - Database operations
- storage - File storage operations
- functions - Serverless functions invocation
- auth - User authentication
- ai - AI chat and image generation
- realtime - Real-time pub/sub (database + client events) via WebSockets

Available languages:
- typescript - JavaScript/TypeScript SDK
- swift - Swift SDK (for iOS, macOS, tvOS, and watchOS)
- kotlin - Kotlin SDK (for Android and JVM applications)
- rest-api - REST API

## When to Use SDK vs MCP Tools

### Always SDK for Application Logic:

- Authentication (register, login, logout, profiles)
- Database CRUD (select, insert, update, delete)
- Storage operations (upload, download files)
- AI operations (chat, image generation)
- Serverless function invocation

### Use MCP Tools for Infrastructure:

- Project scaffolding (`download-template`) - Download starter templates with InsForge integration
- Backend setup and metadata (`get-backend-metadata`)
- Database schema management (`run-raw-sql`, `get-table-schema`)
- Storage bucket creation (`create-bucket`, `list-buckets`, `delete-bucket`)
- Serverless function deployment (`create-function`, `update-function`, `delete-function`)
- Frontend deployment (`create-deployment`) - Deploy frontend apps to InsForge hosting

## Important Notes

- For auth: use `auth-sdk` for custom UI, or framework-specific components for pre-built UI
- SDK returns `{data, error}` structure for all operations
- Database inserts require array format: `[{...}]`
- Serverless functions have single endpoint (no subpaths)
- Storage: Upload files to buckets, store URLs in database
- AI operations are OpenAI-compatible
- **EXTRA IMPORTANT**: Use Tailwind CSS 3.4 (do not upgrade to v4). Lock these dependencies in `package.json`

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **InboxPilot** (API base `https://y39ezar3.us-east.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
