/** Structural guard for the auth client's typed failures: the components keep
 * cross-plugin value imports out of the client bundle, so identity comes from
 * the wire fields the auth client always sets. */
export function isAuthError(error: unknown): error is { code: string; status: number; message: string } {
  return error instanceof Error && 'code' in error && typeof (error as { code: unknown }).code === 'string'
}
