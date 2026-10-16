# Convenience targets. Everything also exists as a pnpm script, which is what Windows users run.
.PHONY: check-copy check-content lint test warm
check-copy:
	node scripts/check-copy.mjs
check-content:
	pnpm check-content
lint:
	pnpm lint
test:
	pnpm test
warm:
	node scripts/warm.mjs
