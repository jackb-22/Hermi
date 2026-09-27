# Step 7 visual review

Viewport: iPhone 16e, iOS 26.3 Simulator, `--hermi-saved-review` local fixture. User aesthetic and touch acceptance remains open.

| Surface | Evidence | Inspection |
| --- | --- | --- |
| My Plan starting state | [plan-start.png](plan-start.png) | Top controls remain on one line; existing timeline, warning, Go and pill are visible. |
| Saved drawer | [drawer.png](drawer.png) | Place/Post/Plan cards scroll horizontally above the independent vertical timeline. Third card is visibly clipped at the edge as a sideways-scroll cue. |
| Full Saved | [saved-page.png](saved-page.png) | Separate full page; folder disclosure and loose place rows, each with explicit add/folder controls. |
| Save Plan | [save-modal.png](save-modal.png) | Replaced stock form with pixel panel fields, folder choice and visibility buttons. Solo save disabled without a name. |

Simulator accessibility inspection found the drawer controls, full Saved navigation, plan-name field and visibility buttons. Entered “Sunday wander” and activated Solo Save Plan; the modal dismissed and showed “Plan saved locally.” This tested a nonpersistent fixture. The fixture is reset on launch, so normal-run restart still needs user review. Screenshots do not measure gesture smoothness or 60fps.

The preview uses local sample places/posts. Friends/Public are intent drafts only. No invites or public feed distribution are sent; standalone images are not saved by the backend contract.
