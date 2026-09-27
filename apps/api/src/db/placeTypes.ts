import type { PinType, Tag } from '@itp/shared';
import type { GeoPoint } from './types.ts';

export interface PlaceDoc {
  _id: string;
  name: string;
  category: PinType;
  tags: Tag[];
  loc: GeoPoint;
  address?: string;
  overtureId?: string;
  googlePlaceId?: string;
  venueTagId?: string;
  confidence: number;
  adultOnly: boolean;
  /** Distinct users with a verified check-in (cache; Tiger is the source of truth). */
  been: number;
  wouldGoAgain: { yes: number; total: number };
  hours?: { open: string; close: string; day: number }[];
  /** Two lines summarizing live Review posts here (worker job summarize_reviews). */
  reviewSummary?: { text: string; count: number; at: Date };
  createdAt: Date;
}
