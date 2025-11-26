export function createListener<T extends any[]>() {
  const listeners = new Set<(...args: T) => void>();

  const subscribe = (callback: (...args: T) => void): (() => void) => {
    listeners.add(callback);

    // Return unsubscribe function
    return () => {
      listeners.delete(callback);
    };
  };

  const notify = (...args: T): void => {
    listeners.forEach((callback) => {
      callback(...args);
    });
  };

  return {
    subscribe,
    notify,
  };
}
