function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(String(key)) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => { values.delete(String(key)); },
    setItem: (key, value) => { values.set(String(key), String(value)); },
  };
}

// Install before loading business modules: demo drafts and preferences never
// read or modify the real user's browser storage, even on the same origin.
export function installDemoStorage() {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(window, name, { configurable: true, value: memoryStorage() });
  }
}
