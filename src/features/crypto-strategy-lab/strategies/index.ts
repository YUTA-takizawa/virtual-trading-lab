import { contrarian } from './contrarian.ts';
import { trendFollow } from './trendFollow.ts';
import { maCross } from './maCross.ts';
import { breakout } from './breakout.ts';
import { bollinger } from './bollinger.ts';
import { rsiOnly } from './rsiOnly.ts';
import { dca } from './dca.ts';
import { grid } from './grid.ts';
import { momentum } from './momentum.ts';
import { volumeSpike } from './volumeSpike.ts';
import { macd } from './macd.ts';
import { ichimoku } from './ichimoku.ts';
import { stochastic } from './stochastic.ts';
import { atrBreakout } from './atrBreakout.ts';
import { vwapDeviation } from './vwapDeviation.ts';
import { dayOfWeek } from './dayOfWeek.ts';
import { parabolicReversal } from './parabolicReversal.ts';
import { rsiDivergence } from './rsiDivergence.ts';
import { relativeStrengthPair } from './relativeStrengthPair.ts';
import { keltnerBreakout } from './keltnerBreakout.ts';
import { perfectOrder } from './perfectOrder.ts';
import { roundNumber } from './roundNumber.ts';
import { buyAndHold } from './buyAndHold.ts';
import type { Strategy } from '../types.ts';

export const STRATEGIES: Strategy[] = [
  contrarian,
  trendFollow,
  maCross,
  breakout,
  bollinger,
  rsiOnly,
  dca,
  grid,
  momentum,
  volumeSpike,
  macd,
  ichimoku,
  stochastic,
  atrBreakout,
  vwapDeviation,
  dayOfWeek,
  parabolicReversal,
  rsiDivergence,
  relativeStrengthPair,
  keltnerBreakout,
  perfectOrder,
  roundNumber,
  buyAndHold,
];
