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
  tasteDone: boolean;
  createdAt: Date;
  deletedAt?: Date;
}
