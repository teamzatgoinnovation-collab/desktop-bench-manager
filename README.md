# Bench Manager Desktop

**Status:** Runnable Electron shell  
**Kind:** Electron + Vite (splash) → local Next.js Bench Manager  
**Package:** `@zatgo/bench-manager-desktop`  
**Wraps:** [`Clients/web/bench-manager`](../web/bench-manager) on port **3008**  
**Stack:** [FRONTEND_STACK](../../../Docs/Foundation/FRONTEND_STACK.md)

Desktop window for the **local ops console** (Docker + SSH). The Electron app starts (or attaches to) the Next.js Bench Manager on this machine and loads it — same Cloud/Local capabilities as `http://localhost:3008`.

## Why desktop

- Keeps SSH keys and Docker on your PC (not Vercel)
- One launcher instead of a browser tab
- Quits the Next child process it started when you close the app

## Run

From the workspace root (after `pnpm install`):

```bash
pnpm dev:bench-manager-desktop
```

Or:

```bash
pnpm --filter @zatgo/bench-manager-desktop dev
```

Configure Cloud SSH in the web app’s Settings (or `Clients/web/bench-manager/.env.local`):

```bash
BENCH_MANAGER_TOKEN=…
DO_SSH_HOST=157.230.8.164
DO_SSH_USER=root
DO_SSH_KEY_PATH=/home/YOU/.ssh/id_ed25519
```

Login uses the same token as the web Bench Manager.

## Optional env (Electron)

| Variable | Purpose |
|----------|---------|
| `BENCH_MANAGER_URL` | Override UI URL (default `http://127.0.0.1:3008`) |
| `BENCH_MANAGER_PORT` | Port when spawning Next (default `3008`) |
| `BENCH_MANAGER_WEB` | Absolute path to `Clients/web/bench-manager` |
| `WORKSPACE_ROOT` | WorkSpace root (resolves `Clients/web/bench-manager`) |

If something is already listening on 3008, the desktop attaches without spawning a second server.

## Scripts

| Script | Description |
|--------|-------------|
| `dev` | Vite + Electron (splash port 5188) → Next on 3008 |
| `build` | Typecheck + production Electron/splash build |
| `typecheck` | `tsc` for splash + electron |

## Security

Local-only ops tool. Do not ship a public build that exposes bench APIs without the token gate. Never put SSH private keys in the Electron package.
