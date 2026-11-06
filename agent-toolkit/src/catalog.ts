/**
 * Static classification of the MCP tools this client is willing to call.
 *
 * The live `tools/list` response is the server's capability-filtered catalog.
 * This table is the client's workflow policy. A name missing from the table
 * is refused, so a newly added server tool cannot be called until someone
 * classifies it. `site_list_tokens` is defined for the in-app agent but
 * excluded from MCP (`server/ai/mcp/registry.ts`); it is not callable here.
 *
 * Classifications follow the current server:
 * - headless reads and browser reads that do not change content are `read`;
 * - `site_open_document` is a read that moves the open canvas;
 * - browser mutations and editor-focus switches are `draft`;
 * - `media_upload` is a server write that stores bytes immediately;
 * - `site_publish` and `content_set_document_status` change visitor-visible
 *   state and stay on the publish gate.
 */
export type ToolClass = 'read' | 'draft' | 'library-write' | 'publish'
export type ToolExecution = 'server' | 'browser'
export type ToolWorkspace = 'none' | 'site' | 'content'

export interface ToolCatalogEntry {
  name: string
  toolClass: ToolClass
  execution: ToolExecution
  workspace: ToolWorkspace
  navigatesEditor: boolean
  summary: string
}

export const TOOLS_NOT_ON_MCP = ['site_list_tokens'] as const

const READ_SERVER = {
  toolClass: 'read' as const,
  execution: 'server' as const,
  workspace: 'none' as const,
  navigatesEditor: false,
}

const READ_SITE = {
  toolClass: 'read' as const,
  execution: 'browser' as const,
  workspace: 'site' as const,
  navigatesEditor: false,
}

const DRAFT_SITE = {
  toolClass: 'draft' as const,
  execution: 'browser' as const,
  workspace: 'site' as const,
  navigatesEditor: false,
}

const DRAFT_CONTENT = {
  toolClass: 'draft' as const,
  execution: 'browser' as const,
  workspace: 'content' as const,
  navigatesEditor: false,
}

export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  {
    ...READ_SERVER,
    name: 'get_context',
    summary: 'Headless orientation: connected workspaces and which templates wrap pages.',
  },
  {
    ...READ_SERVER,
    name: 'site_list_documents',
    summary: 'Headless list of pages, templates, and visual components on the main draft.',
  },
  {
    ...READ_SERVER,
    name: 'site_read_styles',
    summary: 'Headless design-system CSS (tokens, classes, ambient rules) from the main draft.',
  },
  {
    ...READ_SERVER,
    name: 'site_list_breakpoints',
    summary: 'Headless viewport breakpoints from the main draft.',
  },
  {
    ...READ_SERVER,
    name: 'site_list_modules',
    summary: 'Headless catalog of insertable modules. Does not read a page.',
  },
  {
    ...READ_SERVER,
    name: 'site_list_post_types',
    summary: 'Headless routable post types a template can target.',
  },
  {
    ...READ_SERVER,
    name: 'site_list_loop_sources',
    summary: 'Headless loop source ids and {currentEntry.*} tokens.',
  },
  {
    ...READ_SERVER,
    name: 'content_list_collections',
    summary: 'Headless post-type collections visible to the connection.',
  },
  {
    ...READ_SERVER,
    name: 'content_get_collection_schema',
    summary: 'Headless field schema for one post-type collection.',
  },
  {
    ...READ_SERVER,
    name: 'content_list_documents',
    summary: 'Headless documents in one post-type collection.',
  },
  {
    ...READ_SERVER,
    name: 'content_get_document',
    summary: 'Headless read of one content document.',
  },
  {
    ...READ_SERVER,
    name: 'content_search_documents',
    summary: 'Headless search across content documents the connection may see.',
  },
  {
    ...READ_SERVER,
    name: 'content_list_users',
    summary: 'Headless author directory. The server requires users.manage.',
  },
  {
    ...READ_SERVER,
    name: 'content_list_media',
    summary: 'Headless media library listing. The server requires media.read.',
  },
  {
    ...READ_SITE,
    name: 'site_get_node_html',
    summary: 'HTML for one node subtree. Requires the owner Site editor to be open.',
  },
  {
    ...READ_SITE,
    name: 'site_read_document',
    summary: 'Annotated HTML and CSS for a document without switching the canvas. Requires the Site editor.',
  },
  {
    ...READ_SITE,
    name: 'site_list_code_assets',
    summary: 'List code assets in the open Site editor.',
  },
  {
    ...READ_SITE,
    name: 'site_read_code_asset',
    summary: 'Read one code asset in the open Site editor.',
  },
  {
    ...READ_SITE,
    name: 'site_inspect_code_runtime',
    summary: 'Inspect code-asset runtime state in the open Site editor.',
  },
  {
    ...READ_SITE,
    name: 'site_render_snapshot',
    summary: 'Geometry, computed style, and an optional screenshot of the open canvas.',
  },
  {
    name: 'site_open_document',
    toolClass: 'read',
    execution: 'browser',
    workspace: 'site',
    navigatesEditor: true,
    summary: 'Switches the visible Site canvas to a document. Does not change saved content, but it does move the operator\'s editor.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_insert_html',
    summary: 'Insert HTML into the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_replace_node_html',
    summary: 'Replace one node subtree in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_delete_node',
    summary: 'Delete a node from the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_update_node_props',
    summary: 'Update content props on a node in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_move_node',
    summary: 'Move a node in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_rename_node',
    summary: 'Rename a node in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_duplicate_node',
    summary: 'Duplicate a node in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_apply_css',
    summary: 'Apply CSS to the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_assign_class',
    summary: 'Assign a class in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_remove_class',
    summary: 'Remove a class in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_write_code_asset',
    summary: 'Write a code asset in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_patch_code_asset',
    summary: 'Patch a code asset in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_add_page',
    summary: 'Add a page in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_delete_page',
    summary: 'Delete a page in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_rename_page',
    summary: 'Rename a page in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_duplicate_page',
    summary: 'Duplicate a page in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_set_page_template',
    summary: 'Set a page template in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_clear_page_template',
    summary: 'Clear a page template in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_set_color_tokens',
    summary: 'Change color tokens in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_set_font_tokens',
    summary: 'Change font tokens in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_set_type_scale',
    summary: 'Change the type scale in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_SITE,
    name: 'site_set_spacing_scale',
    summary: 'Change the spacing scale in the open Site draft. Does not publish.',
  },
  {
    ...DRAFT_CONTENT,
    name: 'content_create_document',
    summary: 'Create a draft content document in the open Content workspace. Does not publish it.',
  },
  {
    ...DRAFT_CONTENT,
    name: 'content_delete_document',
    summary: 'Soft-delete a content document in the open Content workspace.',
  },
  {
    ...DRAFT_CONTENT,
    name: 'content_set_document_field',
    summary: 'Write one field on the active content document. Does not publish.',
  },
  {
    ...DRAFT_CONTENT,
    name: 'content_set_document_fields',
    summary: 'Write several fields on the active content document. Does not publish.',
  },
  {
    ...DRAFT_CONTENT,
    name: 'content_set_document_author',
    summary: 'Reassign a content document author in the open Content workspace.',
  },
  {
    ...DRAFT_CONTENT,
    name: 'content_set_active_document',
    navigatesEditor: true,
    summary: 'Focus a content document in the open Content workspace. Required before field writes.',
  },
  {
    ...DRAFT_CONTENT,
    name: 'content_set_active_collection',
    navigatesEditor: true,
    summary: 'Focus a collection in the open Content workspace.',
  },
  {
    name: 'media_upload',
    toolClass: 'library-write',
    execution: 'server',
    workspace: 'none',
    navigatesEditor: false,
    summary: 'Store a new media-library image on the server immediately. Skipping site_publish does not remove it.',
  },
  {
    name: 'site_publish',
    toolClass: 'publish',
    execution: 'server',
    workspace: 'none',
    navigatesEditor: false,
    summary: 'Publish the main-branch draft site. The server has no dry-run. An open branch workspace is not the publish target.',
  },
  {
    name: 'content_set_document_status',
    toolClass: 'publish',
    execution: 'browser',
    workspace: 'content',
    navigatesEditor: false,
    summary: 'Set a content document to draft, unpublished, published, or scheduled. Every status is publish-gated because it changes visitor visibility. Requires the Content workspace.',
  },
]

const BY_NAME = new Map(TOOL_CATALOG.map((entry) => [entry.name, entry]))

export function catalogEntry(name: string): ToolCatalogEntry | undefined {
  return BY_NAME.get(name)
}

/** Headless reads the audit command may call, in order. */
export const AUDIT_READS: readonly { name: string; args: Record<string, unknown> }[] = [
  { name: 'get_context', args: {} },
  { name: 'site_list_documents', args: {} },
  { name: 'site_read_styles', args: { format: 'summary' } },
  { name: 'site_list_breakpoints', args: {} },
  { name: 'site_list_modules', args: {} },
  { name: 'site_list_post_types', args: {} },
  { name: 'site_list_loop_sources', args: {} },
  { name: 'content_list_collections', args: {} },
]
