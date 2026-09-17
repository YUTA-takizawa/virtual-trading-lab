export function requireEnv(name: string, { optional = false }: { optional?: boolean } = {}): string {
  const value = process.env[name];
  if (!value && !optional) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? '';
}
