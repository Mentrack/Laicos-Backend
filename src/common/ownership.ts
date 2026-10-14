import { Role, type User } from '../../generated/client';

/** Farm `where` fragment matching farms owned by `user`'s Farmer. */
export function farmOwnedBy(user: Pick<User, 'id'>) {
  return { owner: { userId: user.id } };
}

/** Farm `where` fragment matching farms in an agent's cluster. */
export function farmInAgentCluster(user: Pick<User, 'id'>) {
  return { cluster: { agent: { userId: user.id } } };
}

/** Owner for farmers; cluster membership for extension agents. */
export function farmReadableBy(user: Pick<User, 'id' | 'role'>) {
  return user.role === Role.EXTENSION_AGENT
    ? farmInAgentCluster(user)
    : farmOwnedBy(user);
}
