export const delay = (milliseconds: number): Promise<void> => {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

export const withTimeout = async <T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> => {
  if (milliseconds <= 0) {
    return promise;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};
