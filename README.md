# NoduleBridge

NoduleBridge, a product by Asklevia, helps close the follow-up gap for incidental lung nodules found on CT. It reads a chest CT and its radiology report, links the nodule to the report sentence, applies the Fleischner Society 2017 rules in deterministic code, and explains the next step in plain Arabic and English. It supports follow-up decisions and never diagnoses. Hackathon prototype; example data only (TCIA LIDC-IDRI, CC BY 3.0).

## Run

Requires Node 22, pnpm, Python 3.11+ and uv.

```
cp .env.example .env
pnpm install
pnpm --dir web install
uv sync --project api
pnpm dev        # web :3000 + api :8000 (set API_PORT to change)
pnpm test
pnpm lint
pnpm schemas    # regenerate TS and Python types from /shared/schemas
```

Build plan and rules: `docs/build/`.

## Privacy and safety limits

This is a prototype for example data. Do not use it with real patient data.

- **DICOM de-identification runs in the browser** (`web/src/features/privacy/deidentify.ts`, a documented subset of DICOM PS3.15 Basic Application Level Confidentiality Profile). It removes the identifying tags and every private tag, shifts study dates by a random per-session offset, replaces UIDs (except for known LIDC-IDRI series, which TCIA already de-identified), keeps geometry and pixels, and renames files. Nothing from a scan is sent to the server in this prototype.
- **Pixel scrubbing is out of scope.** Text burned into the image stays. A non-LIDC scan whose `BurnedInAnnotation` is `YES` or missing is refused ("This scan may have patient details burned into the images. It was not uploaded.") instead of being cleaned.
- **Report text is checked by patterns before the model reads it** (`api/app/services/redact.py`, `POST /redact`): names on "Patient:" lines, record and accession numbers, phone numbers, dates of birth, e-mail addresses. The person sees what was redacted and confirms. Pattern matching is not complete: it misses names in running text and unusual formats.
- **Verification:** `pnpm check-content` (fails until a clinician reviews the Arabic and English patient text), `pnpm check-copy` (voice rules, part of `pnpm lint`), guardrail tests in `api/tests/test_guardrails.py` and `web/tests/e2e/guardrails.spec.ts`, accessibility checks in `web/tests/e2e/accessibility.spec.ts`. In the app, "Show verification" lists where each part of a result came from.
