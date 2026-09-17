import { swingBracket } from './swingBracket.ts';
import { buyAndHold } from './buyAndHold.ts';
import type { Strategy } from '../types.ts';

export const STRATEGIES: Strategy[] = [swingBracket, buyAndHold];
