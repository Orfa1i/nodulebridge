# Phase 5 — The Fleischner 2017 rule engine (deterministic)

**Time budget:** 6 hours · **Needs:** Phase 4 schema · **Produces:** a pure, fully tested function from extracted findings + patient context to a follow-up recommendation with its table row and citation.

## Goal

`recommend(findings, context) -> FollowupRecommendation` is plain Python with no network and no LLM. Same input, same output, always. Every row of the guideline table has a test.

## Source

MacMahon H, Naidich DP, Goo JM, et al. *Guidelines for Management of Incidental Pulmonary Nodules Detected on CT Images: From the Fleischner Society 2017.* Radiology 2017;284(1):228–243.

The table below is transcribed for implementation. **Before the demo video, a clinician on the team checks every row against Table 1 of the paper and ticks it in `docs/build/fleischner-checklist.md` (create it with one checkbox per rule id).** Do not copy the paper’s text into the product; encode the rules and cite the paper.

### Applicability gate (check first)

The guideline applies to incidental nodules in adults **35 years or older**. It does **not** apply to: lung cancer screening examinations, patients with known primary cancer, immunocompromised patients. Return `applies: false` with the reason when any of these is true. When age, cancer history or immune status is **unknown**, return `applies: "conditional"` and list the questions the patient should confirm with their doctor (the recommendation is shown as conditional on those answers).

### Size

Size = mean of long and short axis, rounded to the nearest whole mm (Phase 4 computes it). Bands: **< 6 mm**, **6–8 mm**, **> 8 mm** (solid); **< 6 mm**, **≥ 6 mm** (subsolid).

### Solid nodules

| Rule id | Count | Size | Low risk | High risk |
|---|---|---|---|---|
| `FL17-S1-LT6` | single | < 6 mm | No routine follow-up | Optional CT at 12 months |
| `FL17-S1-6TO8` | single | 6–8 mm | CT at 6–12 months, then consider CT at 18–24 months | CT at 6–12 months, then CT at 18–24 months |
| `FL17-S1-GT8` | single | > 8 mm | Consider CT at 3 months, PET/CT, or tissue sampling | Same as low risk |
| `FL17-SM-LT6` | multiple | < 6 mm | No routine follow-up | Optional CT at 12 months |
| `FL17-SM-6TO8` | multiple | 6–8 mm | CT at 3–6 months, then consider CT at 18–24 months | CT at 3–6 months, then CT at 18–24 months |
| `FL17-SM-GT8` | multiple | > 8 mm | CT at 3–6 months, then consider CT at 18–24 months | Same as low risk |

### Subsolid nodules

| Rule id | Type | Size | Recommendation |
|---|---|---|---|
| `FL17-GGN1-LT6` | single ground-glass | < 6 mm | No routine follow-up |
| `FL17-GGN1-GE6` | single ground-glass | ≥ 6 mm | CT at 6–12 months to confirm persistence, then CT every 2 years until 5 years |
| `FL17-PS1-LT6` | single part-solid | < 6 mm | No routine follow-up |
| `FL17-PS1-GE6` | single part-solid | ≥ 6 mm | CT at 3–6 months to confirm persistence; if unchanged and solid component remains < 6 mm, annual CT for 5 years |
| `FL17-SSM-LT6` | multiple subsolid | < 6 mm | CT at 3–6 months; if stable, consider CT at 2 and 4 years |
| `FL17-SSM-GE6` | multiple subsolid | ≥ 6 mm | CT at 3–6 months; further management based on the most suspicious nodule |

Add a flag (not a new interval) when a part-solid nodule’s solid component is ≥ 6 mm: `notes += "Solid component of 6 mm or more is a concerning feature; discuss promptly with your doctor."` `TODO-VERIFY:` exact wording against the paper’s remarks.

### Cases the table does not cover

- `benign_features` present (benign calcification pattern, fat): `applies: false`, reason “The report describes features usually seen in benign nodules. Confirm with your doctor whether follow-up is needed.”
- `assertion` is `hedged` only: show the finding as “possible nodule”, `applies: "conditional"`, advise asking the doctor.
- `attenuation: unknown`: use the solid table (the more common default) **only** as conditional, with the note “The report does not say whether the nodule is solid.”
- A stability statement (“stable since …”): do not compute a new interval; `applies: "conditional"` with “The report compares with an earlier scan. Ask your doctor whether more scans are needed.”
- Multiple nodules: rule chosen by the largest or most suspicious nodule (part-solid > ground-glass > solid at equal size). Record which nodule drove the rule.

### Risk tier

Fleischner uses low (< 5% estimated cancer risk) and high (> 5%) risk, from factors such as heavy smoking, older age, family history, upper-lobe location, spiculation and emphysema. NoduleBridge does **not** compute a cancer risk. Input `risk_tier` is `low | high | unknown`:
- `unknown` (the default): when the low- and high-risk rows match, show that one recommendation; when they differ, show both, labelled “If your doctor considers your risk low” and “If your doctor considers your risk higher”.
- Factors the report states (spiculation, upper lobe, smoking) are listed under “Factors your doctor may consider”, never turned into a tier.

## Steps

1. Fill `/shared/schemas/followup-recommendation.schema.json`: `applies` (`true|false|"conditional"`), `not_applicable_reasons[]`, `questions_for_doctor[]`, `rule_id`, `driving_nodule_id`, `size_band`, `risk_tier_used`, `options[] {label, actions[] {type: CT|PET_CT|TISSUE_SAMPLING|NONE, window_months: [min, max] | null, optional, then: [...]}}`, `notes[]`, `factors_to_consider[]`, `citation`, `engine_version`.
2. Implement `api/app/rules/fleischner2017.py` as a data table (a list of rule dicts) plus a small matcher; no `if` ladders that duplicate the table.
3. Due windows: `api/app/rules/dates.py` turns `window_months` + study date into calendar dates (`window_start`, `window_end`). If no study date, use the analysis date and say so. Use `dateutil.relativedelta`.
4. Endpoint `POST /recommend` takes the Phase 4 result (+ optional `risk_tier`, `age_years`, `known_cancer`, `immunocompromised` the user confirms in the UI) and returns the recommendation.
5. Tests (`api/tests/test_fleischner.py`): one test per rule id per risk tier; boundaries (5, 6, 8, 9 mm; rounding 8.4 → 8, 8.5 → 9 using round-half-up, not Python’s banker’s rounding: use `Decimal.quantize(ROUND_HALF_UP)`); every gate (age 34/35/unknown, screening, known cancer, immunocompromised); benign features; hedged; stability; multiple-nodule selection; property test (Hypothesis): output always has `citation` and either `rule_id` or `not_applicable_reasons`.
6. UI — **Next step card** (title “Guideline next step”, `ak-badge--brand` “Guideline rule”, never the AI badge):
   - Headline in Funnel Display: for Case A, “Consider a CT in about 3 months, a PET-CT, or a biopsy.” Built from the rule, not typed.
   - Under it, the due window in Geist Mono (“CT window opens 16 Jan 2027”).
   - “Why”: “Single solid nodule, 9 mm (mean of 10 × 8 mm), Fleischner 2017, rule FL17-S1-GT8.” with the citation as a link.
   - If conditional: an `ak-alert--warning` listing the questions for the doctor, plus quick confirm chips (“I am 35 or older”, “I have no known cancer”, “My immune system is not weakened”) that re-run `/recommend`.
   - If not applicable: `ak-alert--info` with the reason and “Ask your doctor about follow-up.”

## Acceptance checks

- `pytest api/tests/test_fleischner.py` passes with 100% line coverage of `fleischner2017.py`.
- Case A → `FL17-S1-GT8`; Case B → `FL17-S1-6TO8`; Case C → the matching subsolid rule. Paste outputs into `progress.md`.
- `fleischner-checklist.md` exists with one unticked box per rule id (the team ticks them, not you).
