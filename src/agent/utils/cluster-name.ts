/** A cluster is named after its agent's LGA. */
export function clusterName(lgaName: string): string {
  return `${lgaName} Hub`;
}
