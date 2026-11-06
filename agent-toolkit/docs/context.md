# Context

Instatic already exposes MCP at `/_instatic/mcp`. This toolkit is a client for that endpoint. It does not embed a page-tree library, an HTML importer, or a publisher.

## What a call can change

| Class | Where it runs | What it changes | Visitor-visible? |
| --- | --- | --- | --- |
| `read` server | In the Bun process | Nothing | No |
| `read` browser | Open Site editor | Nothing saved. `site_open_document` moves the canvas | No |
| `draft` | Open Site or Content workspace | The collaboration draft | No, until a later publish |
| `library-write` | Server (`media_upload`) | Media library bytes | The file is stored immediately; pages that already point at it are unchanged until a publish that references it |
| `publish` | `site_publish` on the server, or `content_set_document_status` in the Content workspace | Public site slot, or one content document's status | Yes |

Draft page tools (`site_insert_html`, `site_apply_css`, token tools, and the other `draft` names in `src/catalog.ts`) save through the open editor. They do not publish. The collab relay persists the draft. A following headless read flushes that relay first, so it can show the draft while the public URL is still the previous publish.

`site_publish` publishes the main-branch draft site. It does not take a page id. It does not publish a branch the editor happens to have open.

`content_set_document_status` is the content-row lifecycle tool. `published` and `scheduled` make a document public. `draft` and `unpublished` take it back. This client treats every status as publish work.

## Grants

The server drops tools the connection cannot use. Mutating tools require `ai.tools.write` in addition to their own capability. `site_publish` requires `pages.publish` (and `ai.tools.write` because it mutates). `media_upload` requires `media.write` plus `ai.tools.write`. Content field edits require a content edit capability. Document status requires a content publish capability.

`tools/list` is the authority for what this token can do. This client's catalog is the authority for what this process is willing to call. A server tool that is not in `src/catalog.ts` is refused until it is classified.

## Editor requirement

`get_context` reports whether the Site editor and Content workspace are connected. It is headless. If it reports a workspace disconnected, browser tools for that scope will fail. Ask the operator to open the matching workspace in a browser signed in as the connection owner. Do not retry a browser tool in a loop, and do not substitute a database write.

Two admin tabs for the same user and scope: the newest bridge wins. Use one editor window.

## Config

`examples/instance.example.json` has origin, connector label, an optional branch note, and a public path. Copy it to `agent-toolkit/instances/<name>/instance.json` (gitignored). Do not add a token key. `examples/mcp-client.example.json` shows an MCP host entry whose header is an environment placeholder. Replace the origin. Do not commit a file in which the placeholder has been replaced with a real token.

## Public probe

`audit` GETs `origin + publicPath` before and after its reads, with no bearer header, and records status, byte length, and SHA-256. It does not store the body. Responses over 20 MiB are reported as errors and are not hashed. Equal hashes mean those reads did not change that URL's bytes. They do not prove a later publish is safe.
