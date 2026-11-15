/**
 * Wraps a promise with a deadline. Rejects with an Error if the operation
 * does not complete within the specified milliseconds.
 *
 * @param operation - The promise to race.
 * @param deadlineMs - Maximum time to wait.
 * @returns The resolved value of the operation.
 * @throws Error "Deadline exceeded" if the timeout wins.
 */
export async function withDeadline<T>(operation: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Deadline exceeded")), deadlineMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
