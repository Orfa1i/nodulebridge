---
title: NoduleBridge
sdk: docker
app_port: 7860
pinned: false
short_description: Follow-up support for incidental lung nodules (hackathon demo, example data only)
---

NoduleBridge by Asklevia: reads a chest CT report, links the nodule to the scan, applies the Fleischner Society 2017 rules in code, and explains the next step in Arabic and English.

This Space is the live demo. It is built and pushed from the GitHub repository by a workflow; the code and the documentation are there. Example data only (TCIA LIDC-IDRI, CC BY 3.0). Decision and adherence support only, not a diagnosis.

This public demo runs without a language-model key: the 18 example studies are served from stored model answers, so reading a new report of your own is switched off here.
