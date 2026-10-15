# Unreleased

- Keep collection, source and annotation discovery steady after a save instead of briefly flashing loading banners. Initial loading and genuine refresh failures remain visible.

- Keep Find options beside their checkboxes, with larger clickable labels on phones.

- Keep the export result visible after “Export anyway” closes the review dialog, and report download failures instead of leaving them silent.

- Keep the optional install prompt above the phone's Sidebar, Write and Preview controls.
- Keep every typed line break visible in the editor, including after reload or moving the cursor. Remove the hard-wrap display-folding preference; PDF and preview keep ordinary Markdown semantics.
- End an empty list item with a blank separator so following text is outside the list. Avoid duplicate bullets when an explicit marker follows automatic continuation, without changing manually authored nested lists.

- Clearly pause editing while a recovered local draft awaits review, instead of allowing typing that is ignored or reporting “Saved”. The comparison opens at the highlighted changed passage, even in long records.

- Keep figure captions and cross-references labelled as figures when an image is missing, instead of switching them to listings.
- Use the same actionable missing-image guidance for PDF, Word and bundle exports without repeating it. Explain in plain language when Word includes an image's description instead of the image.
