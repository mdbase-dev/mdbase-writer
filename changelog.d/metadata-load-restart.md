## Fixed

- Saving no longer shows "cursor_stale", "Writer's native query snapshot changed." or "Writer's contract metadata snapshot or digest changed." until Retry is pressed in larger collections. A save that lands while Writer is loading the collection's index now makes Writer start the load again (up to three times) instead of reporting an error.
