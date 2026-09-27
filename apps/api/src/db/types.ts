import type { PinType, Tag } from '@itp/shared';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

export interface UserDoc {
  _id: string;
  appleSub?: string;
  name?: string;
  username?: string;
  photoKey?: string;
  /** A new profile photo waiting on (or refused by) the deepfake scan; photoKey stays the old one meanwhile. */
  photoReview?: {
    key: string;
    origKey: string;
    contentType: string;
    status: 'scanning' | 'rejected';
    reason?: string;
    requestId?: string;
    at: Date;
  };
  spriteKey?: string;
  campus?: string;
  gradYear?: number;
  verifiedAt?: Date;
  eduEmailHash?: string;
  is21: boolean;
  prefVector?: number[];
  dislikes?: { categories: PinType[]; tags: Tag[] };
  openToPlans: boolean;
  ghostMode: boolean;
  tagId?: string;
  backboardAssistantId?: string;
  pushTokens?: string[];
  /** Week index of the last weekly nudge (at most one a week). */
  lastNudgeWeek?: number;
  tasteDone: boolean;
  createdAt: Date;
  deletedAt?: Date;
}
