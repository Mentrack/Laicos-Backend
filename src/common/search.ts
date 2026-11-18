export function searchTokens(search?: string): string[] {
  return search?.split(/\s+/).filter(Boolean) ?? [];
}
