export function formatMoney(value: number): string {
  return `${Math.round(value).toLocaleString('ja-JP')}円`;
}

export function formatSignedMoney(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatMoney(value)}`;
}
