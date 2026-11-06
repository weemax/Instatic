# Instatic agent toolkit

This file is the rule book for an agent operating one Instatic site through `agent-toolkit/`. The repository root `AGENTS.md` is for people changing Instatic itself. Follow this file when the task is to read or change site content.

The only execution path is:

```sh
bun agent-toolkit/src/cli.ts <command> --config <instance.json>
```

That command talks to the instance's existing `/_instatic/mcp` endpoint. Do not add another writer.

## Do not

- Do not edit files under `uploads/published/`. Those are publish output.
- Do not write SQL or update `data_rows` / `site_snapshots` yourself.
- Do not import a site-bundle ZIP from this toolkit. `replace` is destructive and is an admin action, not an MCP tool.
- Do not eval JavaScript, start a local relay, or drive the editor through a browser debug port.
- Do not invent a headless page-tree edit. Structural edits exist only as browser tools. If the Site or Content workspace is closed, stop and ask the operator to open it. A failed browser tool is not permission to write the database.
- Do not publish, upload media, or call a draft tool from an audit.
- Do not put a bearer token in a file, a commit, a log, a prompt, or a command argument. The CLI reads `INSTATIC_MCP_TOKEN` only when it is about to send a request, and it refuses `--token`. A refusal or a `--dry-run` does not need the variable set.

## Tiers

1. **Read (default).** `check`, `discover`, `list`, `audit`, and `call` of a tool classified `read`. No backup flag is required. `audit` calls only headless reads the server actually offered, then GETs `publicPath` with no `Authorization` header.
2. **Draft.** Tools classified `draft` or `library-write`. Requires `--allow-drafts`, `--backup-id`, a previous `--dry-run` of the same plan, then a separate invocation with `--confirm-reviewed`. `--dry-run` never sends, including when `--confirm-reviewed` is also present. The receipt is single-use and expires after 12 hours.
3. **Publish.** `site_publish` and `content_set_document_status` (every status, including a return to draft). Requires `--allow-publish` and `--approve-publish`, plus the same backup, dry-run, and confirm steps. `--allow-drafts` does not publish. `--allow-publish` does not allow draft or media calls.

`media_upload` is a library write, not a draft and not a publish. The server stores the file immediately. Skipping `site_publish` does not remove it.

`site_open_document` is a read that moves the operator's canvas. It also needs `--allow-editor-navigation`. Prefer `site_read_document`, which does not switch the visible document.

## Workspace facts the client cannot change

- Browser tools run only in the connector owner's open Site or Content workspace. The newest open instance for that user and scope wins. This client cannot open, focus, or choose that window.
- Headless reads and `site_publish` use the main draft. `branchLabel` in the config is a note for the operator. It is not sent. An edit made while a branch is open is not what `site_publish` publishes.
- The server has no publish dry-run. After this client sends `site_publish`, the server flushes collaboration state, writes the publish snapshot, and swaps the public slot.
- Capability filtering is server-side: a mutating tool also needs `ai.tools.write`, and `requiredCapabilities` is any-of. `tools/list` is the grant. A tool missing from that list is not available to this token.

## Client flags are not authorization

Refusals from this CLI bind only this process. They are not a security boundary and they do not replace server authorization. A token that includes `pages.publish` or `ai.tools.write` can still publish or edit through any other MCP client. Use a read-only grant (no `ai.tools.write`, no `pages.publish`) for audit work. Add `pages.publish` only on the token used for an already approved publish.

## Before any write

Use a staging instance. Take a backup the operator can restore: a database dump plus the uploads directory, or a site-bundle export. Record its label and pass that label as `--backup-id`. This toolkit does not create or read backup files.

Read `docs/context.md` for the tool classes and `docs/tasks.md` for the command sequences.
