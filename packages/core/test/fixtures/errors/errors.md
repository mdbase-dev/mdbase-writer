---
title: Error mapping test
csl: apa
---

# Section one {#sec-one}

A fine paragraph citing [@badiouBeing07].

A paragraph with an unknown citekey [@nosuchkey2020] in it.

A reference to a missing label @fig-missing here.

```{=typst}
#let fine = (1, 2)
```

Inline math that mitex rejects $\frac{a}{$ here.

A last paragraph with *emphasis* and an image ![alt](missing.png).
