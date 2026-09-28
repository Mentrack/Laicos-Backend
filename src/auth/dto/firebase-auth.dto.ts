/** A Firebase session as returned by Google's auth REST endpoints. */
export class FirebaseAuthTokensDto {
  idToken: string;
  refreshToken: string;
  localId: string;
  expiresIn: string;
}

export class FirebaseGoogleSignInDto extends FirebaseAuthTokensDto {
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  /** True when this call created the Firebase account. */
  isNewUser: boolean;
}
