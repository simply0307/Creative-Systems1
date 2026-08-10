export type RuntimeDeploymentMetadata = Readonly<{
  branch: string | null;
  deployId: string | null;
  commitRef: string | null;
}>;

/**
 * The host capabilities currently used by Creative OS business logic.
 * Authentication, blobs, generation, queues, and workflows are deliberately
 * separate boundaries and must not be added to this interface.
 */
export interface RuntimeAdapter {
  readonly name: string;
  getConfig(name: string): string;
  getSecret(name: string): string;
  deploymentMetadata(): RuntimeDeploymentMetadata;
  now(): Date;
  randomUUID(): string;
}
