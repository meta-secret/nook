export function assertLocalDockerHostAllowed(): void {
  if (
    process.env.NOOK_ARC_RUNNER === '1' ||
    process.env.NOOK_BUILDKIT_REMOTE === '1'
  ) {
    throw new Error(
      'Executable skills require an explicit non-ARC local Docker environment.',
    );
  }
}
