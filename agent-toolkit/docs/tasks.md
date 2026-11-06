# Tasks

Run every command from the repository root with Bun. `<config>` is a copy of `agent-toolkit/examples/instance.example.json` whose `origin` is the staging instance. None of these commands take the token as an argument. Export `INSTATIC_MCP_TOKEN` only for a command that sends a request. `check`, `--dry-run`, and a refused write do not read it.

## Read and audit

Use a personal access token that does not include `ai.tools.write` or `pages.publish`.

```sh
bun agent-toolkit/src/cli.ts check --config <config>
bun agent-toolkit/src/cli.ts audit --dry-run --config <config>
bun agent-toolkit/src/cli.ts audit --config <config>
```

`check` validates the file and sends nothing. `audit --dry-run` prints the plan and sends nothing. `audit` discovers the server, lists tools, calls the headless reads that list includes, and probes the public URL twice.

Expect `dispatchedWrites: false`. Expect `publicUnchanged: true` when nobody else published during the audit. A browser tool listed under `notCalled` still needs an open workspace; the audit did not call it. If `get_context` says the Site editor is disconnected, that confirms the bridge model. Leave it disconnected for a read-only pass.

`list` and `discover` are the same endpoint, narrower:

```sh
bun agent-toolkit/src/cli.ts discover --config <config>
bun agent-toolkit/src/cli.ts list --config <config>
```

To read one document without moving the canvas, the Site editor must already be open, and the tool must appear in `list`:

```sh
bun agent-toolkit/src/cli.ts call site_read_document --config <config> --args '{"document":"<id from site_list_documents>"}'
```

Do not call `site_open_document` during an audit. It only runs with `--allow-editor-navigation`, and it changes what the operator is looking at.

## Draft

Stop if the token includes `pages.publish`. Take a backup first (database plus uploads, or a site-bundle export) and choose a label, for example `staging-2026-11-06`. Open one Site workspace as the connection owner. `get_context` should show that workspace connected.

Dry-run, read the printed plan, then send that same plan:

```sh
bun agent-toolkit/src/cli.ts call site_insert_html --config <config> \
  --allow-drafts --backup-id staging-2026-11-06 --dry-run \
  --args '{"html":"<section id=\"agent-draft\">Draft</section>"}'

bun agent-toolkit/src/cli.ts call site_insert_html --config <config> \
  --allow-drafts --backup-id staging-2026-11-06 --confirm-reviewed \
  --args '{"html":"<section id=\"agent-draft\">Draft</section>"}'
```

Then run `audit` again. The editor and a headless document read can show the section. `publicUnchanged` should stay true. Do not call `site_publish`.

Content field writes are the same draft gate, and the Content workspace must be open. Call `content_set_active_document` before `content_set_document_field`. `content_set_document_status` is not a draft tool.

`media_upload` uses the draft flags, not the publish flags. Treat the file as already stored once the call returns.

A changed argument, origin, backup id, or flag is a different receipt. Run `--dry-run` again. Each receipt sends at most one call.

## Publish

Get a new explicit approval in the current request. Approval given for a draft is not approval to publish. Put `pages.publish` on a token only for this step, or use a separate publish token. Keep the backup label from the draft step.

```sh
bun agent-toolkit/src/cli.ts call site_publish --config <config> \
  --allow-publish --approve-publish --backup-id staging-2026-11-06 --dry-run

bun agent-toolkit/src/cli.ts call site_publish --config <config> \
  --allow-publish --approve-publish --backup-id staging-2026-11-06 --confirm-reviewed
```

`site_publish` takes no arguments. The server publishes the main draft site, writes an audit event with `source: mcp`, and swaps the public slot. Probe the public URL again with `audit` or a plain GET. This is the first point at which the public bytes should change.

Publishing one content document is `content_set_document_status` with the same two publish flags, the backup, the dry-run, and the confirm. The Content workspace must be open. That call is not implied by a field edit that used `--allow-drafts`.

If the public page changes before either publish command, stop. The draft/publish split did not hold, and another client or person published.
