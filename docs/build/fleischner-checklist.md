# Fleischner 2017 rule check (for the clinician on the team)

Source: MacMahon H, Naidich DP, Goo JM, et al. *Guidelines for Management of Incidental Pulmonary Nodules Detected on CT Images: From the Fleischner Society 2017.* Radiology 2017;284(1):228–243.

The engine is `api/app/rules/fleischner2017.py`. The rules were transcribed from the phase file, not copied from the paper. **Before the demo video, check every row below against Table 1 of the paper and tick it.** The team ticks these boxes, not the build agent. If a row is wrong, say which one and what it should say; the table is data, so a fix is one edit plus one test.

How to read a row: "Low risk" and "High risk" are the two columns of the paper's table. "Same" means the engine shows one recommendation for both. When the risk tier is unknown (the product never computes it) and the two columns differ, the engine shows both, labelled "If your doctor considers your risk low / higher".

## Solid nodules (size = mean of long and short axis, rounded half up to the whole mm)

- [ ] `FL17-S1-LT6` single, < 6 mm. Low: no routine follow-up. High: optional CT at 12 months.
- [ ] `FL17-S1-6TO8` single, 6–8 mm. Low: CT at 6–12 months, then consider CT at 18–24 months. High: CT at 6–12 months, then CT at 18–24 months.
- [ ] `FL17-S1-GT8` single, > 8 mm (9 mm and above after rounding). Consider CT at 3 months, PET/CT, or tissue sampling. High: same as low.
- [ ] `FL17-SM-LT6` multiple, < 6 mm. Low: no routine follow-up. High: optional CT at 12 months.
- [ ] `FL17-SM-6TO8` multiple, 6–8 mm. Low: CT at 3–6 months, then consider CT at 18–24 months. High: CT at 3–6 months, then CT at 18–24 months.
- [ ] `FL17-SM-GT8` multiple, > 8 mm. CT at 3–6 months, then consider CT at 18–24 months. High: same as low.

## Subsolid nodules

- [ ] `FL17-GGN1-LT6` single ground-glass, < 6 mm. No routine follow-up.
- [ ] `FL17-GGN1-GE6` single ground-glass, ≥ 6 mm. CT at 6–12 months to confirm persistence, then CT every 2 years until 5 years.
- [ ] `FL17-PS1-LT6` single part-solid, < 6 mm. No routine follow-up.
- [ ] `FL17-PS1-GE6` single part-solid, ≥ 6 mm. CT at 3–6 months to confirm persistence; if unchanged and the solid component remains < 6 mm, annual CT for 5 years.
- [ ] `FL17-SSM-LT6` multiple subsolid, < 6 mm. CT at 3–6 months; if stable, consider CT at 2 and 4 years.
- [ ] `FL17-SSM-GE6` multiple subsolid, ≥ 6 mm. CT at 3–6 months; further management based on the most suspicious nodule.

## Applicability gate and special cases (the engine checks these before the table)

- [ ] Applies only to adults 35 years or older; not to lung cancer screening scans, known primary cancer, or immunocompromised patients. Unknown age, cancer history, immune status or screening status gives "conditional" with a question for the doctor.
- [ ] Benign features (calcification pattern, fat, perifissural) or a calcified nodule: "does not apply", with the line "The report describes features usually seen in benign nodules. Confirm with your doctor whether follow-up is needed."
- [ ] Hedged mention only ("possible nodule"): conditional, no interval, advise asking the doctor.
- [ ] Attenuation not stated: solid table, conditional, with the note "The report does not say whether the nodule is solid."
- [ ] A stability statement ("stable since …"): no new interval; conditional with "The report compares with an earlier scan. Ask your doctor whether more scans are needed."
- [ ] Several nodules: the row is chosen by the largest nodule; at equal size part-solid beats ground-glass beats solid.
- [ ] Part-solid with a solid component of 6 mm or more adds the note "Solid component of 6 mm or more is a concerning feature; discuss promptly with your doctor." (wording marked `TODO-VERIFY` in the code against the paper's remarks).
- [ ] Windows are counted from the index scan: the study date, or the analysis date when the report has none (the card says which).

## Open items the build agent could not verify

- [ ] DOI link `https://doi.org/10.1148/radiol.2017161659` resolves to the Fleischner 2017 paper (written from memory; confirm or replace in `CITATION` in `fleischner2017.py`).
- [ ] The risk wording shown to the patient ("If your doctor considers your risk low / higher") is acceptable to the clinician.
- [ ] Months for "CT at 3 months" are counted as calendar months from the index scan (for example 16 Oct → 16 Jan). Acceptable?
