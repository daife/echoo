export async function advanceHandledSequenceAfterSuccessfulRun<T>(
  run: Promise<T>,
  advance: () => Promise<void>,
) {
  const result = await run;
  await advance();
  return result;
}
