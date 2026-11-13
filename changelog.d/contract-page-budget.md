## Fixed

- Writer now opens collections whose sources or highlights carry a lot of metadata. Loading the manuscript list and index failed with "could not complete (too_large)" when 128 records of one kind exceeded the collection's per-request limit; Writer now asks again for fewer records at a time.
- A collection operation that fails now names the specific reason after the error code, so a report says what was refused.
