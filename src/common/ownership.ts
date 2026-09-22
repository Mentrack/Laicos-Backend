import type { User } from '../../generated/client';

/** Farm `where` fragment matching farms owned by `user`'s Farmer. */
export function farmOwnedBy(user: Pick<User, 'id'>) {
  return { owner: { userId: user.id } };
}
