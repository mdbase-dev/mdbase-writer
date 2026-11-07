## Fixed

- Adopt UI and i18n beta.158 exactly, replace Writer's overlay adapter with the published shared lifecycle, and remove the obsolete optional-presence/animation patches.
- Use the shared failed-opening recovery with SDK beta.159, including a real LAB failed-open → Try again → Home regression and truthful copy when a successful HTTP response contains an unusable runtime asset.
- Preserve immediate editor typing and palette query reset while shared dialogs finish their visual exit, and keep primary press feedback distinct from the new shared hover. Retain these small fixes and the existing environment-isolation, collection accessibility and quota fixes until published upstream.
- Capture the writing position before the workspace header detaches, preserving phone Continue and browser-history scroll positions with the shared font.
- Preserve the shortcut reference's two-column desktop layout when shared dialog styles load after Writer's stylesheet.
- Retain shared overlays until their actual CSS exits finish, rather than truncating them when a timer expires before delayed browser frames.
