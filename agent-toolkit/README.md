# Instatic agent toolkit

A small client workspace for an Instatic instance's existing MCP endpoint, `/_instatic/mcp`. It lists and calls the tools that server already implements. It is not a second CMS, it does not write the database, it does not edit published HTML, and it does not eval JavaScript.

The default is read-only. Draft edits and publishing are separate gated commands. Those gates apply only to this process. They are not a security boundary and they do not replace the server's capability check. Any other MCP client holding the same token can still call whatever that token allows.

Agents start at [`AGENTS.md`](AGENTS.md), then [`docs/context.md`](docs/context.md) and [`docs/tasks.md`](docs/tasks.md).

## Setup

Requirements: Bun 1.4.x, from this repository, and a staging Instatic you control. Do this on a copy of the site, after a backup you can restore.

1. Create a personal access token in **AI → MCP**. For a first session, omit `ai.tools.write` and `pages.publish`. Copy the `imcp_pat_…` value once into your password store.
2. Export it in the shell you will use. Do not write it into a file in this repo, and do not pass it as a flag.

   ```sh
   export INSTATIC_MCP_TOKEN='…'
   ```

3. Copy the example config and edit the origin. Leave every other key as a label. `branchLabel` is not sent to the server.

   ```sh
   mkdir -p agent-toolkit/instances/staging
   cp agent-toolkit/examples/instance.example.json agent-toolkit/instances/staging/instance.json
   ```

   `agent-toolkit/instances/` and `agent-toolkit/**/.local/` are gitignored. Receipts from a dry-run are written beside the config under `.local/receipts/` and must stay local.

4. Point an external MCP host at `https://<origin>/_instatic/mcp` if you want that host to talk to Instatic directly. [`examples/mcp-client.example.json`](examples/mcp-client.example.json) shows the URL and an environment placeholder for the header. If the host cannot expand the placeholder, set the header in the host's secret store and do not commit the result. Hosts that call the endpoint directly do not pass through this CLI's dry-run gate. Prefer a read-only token until you intend to write.

Take the backup before any later write. Use a database dump plus the uploads directory, or a site-bundle export, and record a short label such as `staging-2026-11-06`. Procedures live in [`docs/deployment/backup-restore.md`](../docs/deployment/backup-restore.md) and [`docs/features/site-transfer.md`](../docs/features/site-transfer.md). This CLI does not run them.

## Smoke test

No token and no network:

```sh
bun agent-toolkit/src/cli.ts check --config agent-toolkit/examples/instance.example.json
bun agent-toolkit/src/cli.ts audit --dry-run --config agent-toolkit/examples/instance.example.json
```

`check` prints the endpoint and `"mode": "read-only"`. `audit --dry-run` prints the headless reads it would attempt and does not send them.

Against staging, after the token is exported and `instance.json` points at that origin:

```sh
bun agent-toolkit/src/cli.ts audit --config agent-toolkit/instances/staging/instance.json
```

A read-only grant should list headless reads and omit `site_insert_html` and `site_publish`. `publicUnchanged` should be true. `get_context` reports whether an editor is open; a disconnected workspace is a successful read, not a failed audit.

Draft and publish sequences are in [`docs/tasks.md`](docs/tasks.md). Publishing needs a separate operator approval, a token that actually has `pages.publish`, and both `--allow-publish` and `--approve-publish`. A draft command never adds those flags.

## Tests

```sh
bun test agent-toolkit
bunx tsc -p agent-toolkit/tsconfig.json --noEmit
```

`agent-toolkit/tsconfig.json` is not a project reference of the CMS build. The tests use in-memory and temp-file fixtures. They do not open a network connection, create a token, or call a live MCP server.

## Limits

- Tool policy is the table in `src/catalog.ts`, checked against the server tool definitions by `src/catalog.test.ts`. A new server tool is refused until that table classifies it. `site_list_tokens` is intentionally absent: the MCP registry does not expose it.
- This client cannot open the Site or Content workspace, choose which tab owns the bridge, or aim `site_publish` at a branch.
- The server does not dry-run `site_publish`. The dry-run here only stops this process from sending the call. After a confirmed send, publish runs the full main-site pipeline.
- Argument JSON larger than 8,000,000 characters is refused. Large media uploads belong on a normal MCP client, which also bypasses these workflow flags.
- A dry-run receipt stores the tool arguments, including any media bytes, under `.local/receipts/` next to the config file. That directory is gitignored. It is a review record for one send, not a site backup.
- The public probe hashes at most 20 MiB, stores no body, and sends no bearer token. It does not crawl the site.
- Redaction strips `imcp_pat_…`, `Bearer …`, and the current `INSTATIC_MCP_TOKEN` from errors and printed JSON. It is not a substitute for keeping the token out of arguments.
- OAuth hosted connectors, plugin install, site-bundle import, and direct admin APIs are outside this client.
