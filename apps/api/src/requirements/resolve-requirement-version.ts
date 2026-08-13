export async function resolveRequirementVersionId(input: {
  versionId?: string | null;
  currentVersionId: string | null;
  assertOwned: (versionId: string) => Promise<void>;
}): Promise<string | null> {
  if (!Object.prototype.hasOwnProperty.call(input, 'versionId') || input.versionId === undefined) {
    return input.currentVersionId;
  }
  if (input.versionId === null) {
    return null;
  }
  await input.assertOwned(input.versionId);
  return input.versionId;
}
