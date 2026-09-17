/**
 * 14-period RSI from daily closes (oldest-to-newest). Uses a simple moving
 * average of gains/losses over the trailing 14 changes rather than Wilder's
 * exponential smoothing — a deliberate v1 simplification, easy to verify by
 * hand against fixed fixtures. `closes` must have at least 15 entries (14
 * day-over-day changes); throws otherwise since RSI is undefined without
 * enough history.
 */
export function calcRsi14(closes: number[]): number {
  if (closes.length < 15) {
    throw new Error(`calcRsi14 needs at least 15 daily closes, got ${closes.length}`);
  }

  const recent = closes.slice(-15);
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i < recent.length; i++) {
    // Non-null: `recent` is a fixed-length slice of the last 15 closes, so every index in range is populated.
    const change = recent[i]! - recent[i - 1]!;
    if (change >= 0) {
      gainSum += change;
    } else {
      lossSum += -change;
    }
  }

  const avgGain = gainSum / 14;
  const avgLoss = lossSum / 14;
  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Simple moving average of the trailing `period` daily closes (oldest-to-
 * newest input, most recent `period` entries used). Throws when there isn't
 * enough history, same convention as calcRsi14 — an SMA silently computed
 * over fewer days than requested would misrepresent the trend it's meant to
 * describe rather than fail loudly.
 */
export function calcSma(closes: number[], period: number): number {
  if (closes.length < period) {
    throw new Error(`calcSma needs at least ${period} daily closes, got ${closes.length}`);
  }
  const recent = closes.slice(-period);
  return recent.reduce((sum, c) => sum + c, 0) / recent.length;
}

/**
 * Today's volume (the last entry) divided by the average of the trailing
 * window before it (default 20 days). Returns 0 — rather than Infinity or
 * NaN — when there isn't enough history or the trailing average is zero, so
 * callers treating "ratio >= threshold" as a confirmation signal fail safe
 * under degenerate data instead of firing on a divide-by-zero fluke.
 */
export function calcVolumeRatio(volumes: number[], window = 20): number {
  if (volumes.length < 2) {
    return 0;
  }
  const today = volumes.at(-1)!;
  const trailing = volumes.slice(Math.max(0, volumes.length - 1 - window), -1);
  if (trailing.length === 0) {
    return 0;
  }
  const avg = trailing.reduce((sum, v) => sum + v, 0) / trailing.length;
  if (avg === 0) {
    return 0;
  }
  return today / avg;
}
