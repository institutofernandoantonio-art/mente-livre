type ClassValue = string | number | null | undefined | false | ClassValue[];

function flatten(value: ClassValue, out: string[]): void {
  if (!value && value !== 0) return;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out);
    return;
  }
  out.push(String(value));
}

/** Junta classes condicionais em uma única string, ignorando valores falsy. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  flatten(values, out);
  return out.join(" ");
}
