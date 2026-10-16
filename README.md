# NoduleBridge

NoduleBridge, a product by Asklevia, helps close the follow-up gap for incidental lung nodules found on CT. It reads a chest CT and its radiology report, links the nodule to the report sentence, applies the Fleischner Society 2017 rules in deterministic code, and explains the next step in plain Arabic and English. It supports follow-up decisions and never diagnoses. Hackathon prototype; example data only (TCIA LIDC-IDRI, CC BY 3.0).

## Run

Requires Node 22, pnpm, Python 3.11+ and uv.

```
cp .env.example .env
pnpm install
pnpm --dir web install
uv sync --project api
pnpm dev        # web :3000 + api :8000
pnpm test
pnpm lint
pnpm schemas    # regenerate TS and Python types from /shared/schemas
```

Build plan and rules: `docs/build/`.
