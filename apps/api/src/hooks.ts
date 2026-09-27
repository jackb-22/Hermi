import { checkinHooks } from './services/checkins.ts';
import { groupChatCheckin } from './services/groupChat.ts';
import { venueHangouts } from './services/social.ts';

let registered = false;

/** Check-in side effects, registered once in every process that writes check-ins (API and worker). */
export function registerHooks() {
  if (registered) return;
  registered = true;
  checkinHooks.push(venueHangouts, groupChatCheckin);
}
