export class ToolkitError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = 'ToolkitError'
    this.exitCode = exitCode
  }
}

export const BOUNDARY_NOTICE =
  'Client gating is a workflow guard for this process only. It is not a security boundary and it does not replace server authorization. A token that holds the capability can still perform the action through any other MCP client.'
