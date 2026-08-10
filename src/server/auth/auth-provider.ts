export type CreativeOsRole = "viewer" | "contributor" | "editor" | "admin" | "owner";

export interface VerifiedIdentity {
  authenticated: boolean;
  identityVerified: boolean;
  provider: "netlify_identity" | "supabase_auth" | "local" | null;
  subject: string | null;
  verifiedEmail: string | null;
  trustedClaims: Record<string, unknown>;
  sessionStrength: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  userRole: CreativeOsRole;
  roleSource: string;
  authMethod: string;
  authFailure: string | null;
  authFailureStatus: number | null;
}

export interface AuthProviderContext {
  environment: Record<string, string>;
  supabase?: unknown;
}

export interface AuthProvider {
  readonly name: string;
  authenticate(request: Request, context: AuthProviderContext): Promise<VerifiedIdentity>;
}
