> ARCHIVED PROTOTYPE RECORD — superseded on 2026-09-26. Use [Hermi schema](HERMI_SCHEMA.md), [user tests](../test.md), and [progress](../PROGRESS.md). Statements below about branding, commit restrictions, backend availability and Xcode describe an earlier checkpoint, not current instructions.

# Cairn frontend acceptance tests

Status: test specification. Unless a result is explicitly recorded, these cases have not been run. Requirements refer to [FRONTEND_TRUTH.md](FRONTEND_TRUTH.md). User review is tracked separately in the [increment ledger](FRONTEND_INCREMENTS.md).

## Test method

Each case records: requirement ID, initial state, action/input, expected visible result, expected request/state effect, actual result, test environment, build revision, and evidence. Tests derive from the specification and contracts, not from whichever behavior the prototype happens to implement.

Use three layers:

1. **Local logic:** deterministic clocks, schema-valid fixtures, a recording API stub, and fake device-service interfaces. No real account/location upload. Verify state transitions, ordering, cancellation, and request bodies.
2. **Component and visual:** one component in the native preview with selectable loading, empty, error, boundary, and success examples. User tests gestures, spacing, labels, and recovery.
3. **Integration/device:** configured API plus signed iPhone build. Verify real permissions, links, camera, background behavior, API errors, and the full outing loop. Fixture success does not satisfy this layer.

A scenario picker for isolated components is planned for increment 01; it does not yet exist. The current broad preview is an exploratory reference only.

## Standard cases for every interactive component

| ID | Case | Expected result |
| --- | --- | --- |
| G01 | Initial loading, refresh with existing data, loaded empty, server failure | Each has distinct copy and state; refresh preserves confirmed content; a failed request does not look like empty data. |
| G02 | Tap twice before response; slow reply; dismiss before reply | At most one intended mutation; no duplicate UI or late reopening of a dismissed sheet. |
| G03 | Request A, then B; B returns before A | B stays visible. A cannot overwrite a newer selection or account. |
| G04 | Cancel, 401, 403, 404, 409, 429, 5xx, unreadable response | Correct recovery; no false success; drafts survive recoverable failures. Unknown error remains visible. |
| G05 | 320/390/430-point width, largest accessibility text, long names | No overlap or inaccessible action. Scroll rather than crop critical content. |
| G06 | VoiceOver, keyboard in Mac preview, Reduce Motion | Names/actions are meaningful; focus order is stable; moving effects have a reduced-motion alternative. |
| G07 | Offline during a write; reconnect | Pending state is explicit. No blind duplicate mutation after an ambiguous response. |
| G08 | Switch account/API, sign out, app relaunch | No previous user's content, token, route, or pending request leaks into the new context. |
| G09 | Preview interaction | Fixture-only behavior; zero authenticated mutations or real proof creation. |

## Feature and boundary cases

All numeric proof boundaries below are business-rule fixtures for client handling. The backend remains the verifier; client-side timers and distances are never sufficient proof.

| ID | Component / initial state | Input or boundary | Expected result |
| --- | --- | --- | --- |
| N01 | New Home | Launch, tap Feed/Profile/Map; swipe map/feed | Map initially selected; taps change panels; owned gestures never switch panels. R03. |
| N02 | Map navigation | Pan, end pan; open peek/half/full sheet; back/dismiss | Pill returns about 300 ms after movement; one sheet; back preserves draft/map. R05. |
| N03 | Active session | Try to reach Feed; change Directions/Camera; open sheet | Feed absent; tracker survives view changes; no second session. R04/R10. |
| A01 | Taste before authentication | 0, 1, and full-deck choices; cancel Apple sign-in | Cannot submit invalid empty taste; choices retained; remaining onboarding not skipped. |
| A02 | Age gating | Change 21+ confirmation after choices | Adult cards/venues do not remain from stale choices; no adult data in an unconfirmed state. |
| A03 | Profile form | Username lengths 2/3/20/21; uppercase, spaces, allowed `_`/`.`; duplicate username | Validate shared regex and limits; show `USERNAME_TAKEN`; preserve inputs. |
| A04 | Mandatory school verification | Nonallowed domain; code lengths 5/6/7; invalid/expired code; canceled verification; returning unverified account | Specific error and resend/retry path; no Home access or verified badge until the server confirms verification. |
| M01 | Category dial | Wrap Music→All→Food and back | Exactly seven categories plus All; live filter matches selected category. R07. |
| M02 | Map query | Fast pan and category change; empty result; tiles fail | Latest bounds/category win; no fake markers or auto-repeated error toasts. |
| M03 | Geographic view | NYC bounds; borough/block zoom endpoints | Panning and zoom stay within agreed bounds; attribution stays visible. |
| M04 | Drop pin | Zoom-derived radius; no places within 1.2 km | No radius slider; present server results/search radius and an honest empty state. Dropping a pin, canceling, receiving no results, or failing to load does not change the plan. |
| P01 | Place sheet | Null percentage/hours/summary; zero counts; long name | Unknown stays unknown; zero is displayed only when returned; primary action remains reachable. |
| P02 | Place from Plan | Open, expand, back, dismiss | Same plan, selection, and stop IDs survive; no added stop from merely viewing. |
| L01 | Draft plan | 0, 1, 12, 13, and large positive stop counts | Zero cannot start; every positive count is product-valid with no fixed maximum. Live tests above 12 are blocked by the current backend cap; retain the draft and report the conflict rather than redefining the requirement. |
| L02 | Explicit stop selection | Drop pin; inspect place; cancel; Add selected place; missing place; server returns legacy slot | Only Add with an explicit place creates a plan item. Submit place-based stops only. Discovery and cancellation leave the plan unchanged. Legacy slot handling requires a reviewed recovery policy; never silently discard it or treat it as a ready destination. |
| L03 | Reorder/edit | First/last stop move; remove middle; set stay 4/5/240/241 minutes | Bound moves safely; preserve IDs; valid stays 5–240; update from server. |
| L04 | Scheduling source | Reorder an AI stay; change one leg; change overall mode | Reorder does not create a user override; one-leg edit stays local to leg; overall reset matches API. |
| L05 | Asynchronous plan edits | Edit while schedule runs; two reorder requests | Explicit serialization/supersession; no stale response restores deleted stops. |
| L06 | Timing warnings and ghost changes | Closed venue/end-time conflict; proceed, edit, AI revise; accept/dismiss | Show advisory warning and allow proceeding despite timing issues; no silent AI change; sources remain visible. Plans contain explicit places only; discovery pins are never plan items. |
| L07 | Save / sharing | Blank/80/81-character name; 0/20/21 invitees; nonverified Find someone | Validate contract; invalid sharing remains unsaved; never grant membership optimistically. |
| O01 | Start | Denied location; start failure; duplicate tap; existing other session | Clear recovery; failed start stays Home; no duplicate or silently replaced outing. |
| O02 | Outbox | 0/1/500/501 points; failed upload; app restart | No empty batch; split at 500; retained points remain tied to original user/session; confirmed points removed once. |
| O03 | Background | Lock/unlock phone, background/foreground, lost permission | Tracking lifecycle follows the active outing; permission loss is visible; no fabricated fixes. Device test required. |
| O04 | End | Pending route upload; repeated End; worker pending; relaunch during ending | Preserve recoverable outbox/session ID; resume ending/recap; bounded polling with retry. |
| C01 | GPS check-in | 299/300/301-second dwell; 99/100/101 m; 49/50/51 m accuracy | Only server-confirmed success unlocks capture/review. Render no-dwell, too-far, and accuracy errors correctly. |
| C02 | Tag check-in | Invalid tag; valid tag at 149/150/151 m; location denied; expired/repeated request | User requires NFC check-in to work with location denied. Current backend still requires server proximity validation; this acceptance case is blocked pending specification alignment and backend support. Never claim success from local scanning alone. |
| C03 | Check-in cooldown | Same venue just before/at/after 6 hours | Respect server result; duplicate response does not animate a second award. |
| T01 | Personal tags | First tap; reciprocal tap at 119/120/121 s and 49/50/51 m | Waiting until server confirms pairing; countdown stops at zero; no local friendship at timeout. |
| T02 | Streak | Same day; later same week; new week; missed week | Render backend weeks/lit/hangouts; no client XP bonus; no negative timer. |
| V01 | Camera eligibility | No check-in; old/different check-in; permission denied | Clear unavailable state; retain current visit identity; no gallery import for post media. |
| V02 | Capture race | Rapid shutters; move between capture/upload; switch check-in | Each file retains its original timestamp, location, hash, and check-in ID. |
| V03 | Video/audio | Tap photo; 3-second ambient; hold video to 15 s; interrupted recording | Correct media pairing; real measured duration; auto-stop at 15 s. Backend's 16 s schema tolerance does not change the 15 s UX. |
| V04 | Upload | 0 bytes; max 80 MiB boundary; expired URL; failure on PUT/commit | Contract-compliant request; storage headers match response; retain retryable private capture; do not claim verification early. |
| V05 | Verification errors | Hash/time/location rejection; no C2PA credential | Explain failed verification; rejected capture cannot be posted; no unsupported credential claim. |
| Q01 | Recap | Pending/ready/error; no visits; no captures; zero XP | Accurate separate states; no empty selection disguised as a valid post; server XP only. |
| Q02 | Post selection | 0/1/10/11 media; route on/off; caption 280/281; mixed choices | Enforce API selection rules; show rejection without losing selection; no publication before moderation. |
| Q03 | Review | Yes/no; empty/500/501 text; already reviewed; error | Presence-gated; optional text; keep user input on error; zero XP. |
| F01 | Feed visibility | Preloaded card; partially shown; current card; background app | Mark only actually viewed posts; one active media player; stop off-screen/background playback. |
| F02 | Feed end | 0 or 30 unseen posts; end card; no saved places | Finite feed; supported saved-plan action or useful empty state; no infinite reload loop. |
| F03 | Safety | Report/block; failed request; blocked user already visible | Apply confirmed hiding/blocking; show failure; no old content reappears after refresh. |
| S01 | Score thresholds | 0/24/25/26; 74/75/76; each threshold ±1 | Correct stone count; one exact Score; bounded next-stone progress. R02. |
| S02 | Score decrease | 900→899; 899→898; unchanged refresh; Reduced Motion | One stone leaves only at 900→899; no repeat wind; count always matches Score. |
| S03 | Large/invalid Score | 10,000; very large valid integer; negative; missing value | Readable true count without silent display cap; explicit error for invalid required data. |
| S04 | Lifetime exploration | Score expires; no tiles; another user's profile | Own tiles remain; zero exploration isn't a map failure; private routes stay private. |
| S05 | Ranks | No campus rank, tie, empty leaderboard, failed fetch | Do not render a fake `#0`; label missing verification or unavailable data appropriately. |
| B01 | Saved | Save same object twice; mixed folder; copy another plan | Use returned identities; no duplicate client item; distinguish saved copy from original host's plan. |
| B02 | Settings | Toggle fails; account deletion canceled; deletion fails | Roll back/reconcile setting; no false deleted state; destructive action needs explicit confirmation. |

## Fixtures and evidence

Fixtures must be created for each increment, with names such as `place.unreviewed`, `plan.twelveStops`, `score.belowSecondStone`, `session.endingAfterRestart`, and `capture.uploadFailed`. Each fixture records the source schema and intentionally varied field. Broken required fields belong to explicit invalid-contract fixtures only.

A visual review uses a deterministic starting screen and state. Do not make the user hunt through the entire app to reach a component. Provide one launch instruction, at most six primary manual checks, expected results, and a reset action. Broader automated boundary cases remain in the test evidence.

## Current evidence, before framework adoption

| Evidence | Result | Limit |
| --- | --- | --- |
| Mac SwiftUI package build | Passed before the latest formatting/account edits | Does not prove current tree or iPhone build. |
| Native preview launch and initial map screenshot | Passed | Broad preview, not isolated component acceptance. User has not accepted the design. |
| Standalone score/JSON executable | 30,012 assertions passed | Mostly range/boundary assertions over 10,001 score values, not 30,012 independently specified feature tests. Does not test server integration. |
| XCTest | Blocked: module unavailable in command-line-tools installation | Requires suitable Xcode toolchain. |
| Live API and full real-device outing | Not run | API URL, native build/runtime, and configuration are missing. |

No feature is marked accepted based on this evidence. The last rendered preview may differ from the current uncommitted source; increment handoff must identify its exact build.
