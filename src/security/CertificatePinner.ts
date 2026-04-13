export function normalizeFingerprint(input: string): string {
  return input.trim().toUpperCase().replace(/:/g, "");
}

export function matchesPinnedFingerprint(actual: string, pins: string[]): boolean {
  if (pins.length === 0) {
    return true;
  }

  const normalizedActual = normalizeFingerprint(actual);
  return pins.some((pin) => normalizeFingerprint(pin) === normalizedActual);
}
