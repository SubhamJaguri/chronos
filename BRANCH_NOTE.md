# python-prototype - reference only, not runnable

This branch holds the original Python prototype of Chronos, kept as the
reference the TypeScript implementation on `main` was ported from.

**It does not run as-is.** The commit that created it dropped part of its
pathspec silently, so these files were never recorded:

- `src/chronos/core/fixtures.py`
- `pyproject.toml`, `alembic.ini`, `migrations/`
- `docker-compose.yml`, `.github/`, `README.md`, `tests/core/`

`src/chronos/core/domain.py` was restored afterwards from the contract
specification, so the solver and validator sources read coherently. The
fixtures were not recoverable; their semantics were reconstructed in
`src/core/fixtures.ts` on `main`, pinned by the ID conventions the surviving
solver tests assert.

What remains here is the part worth reading: the CP-SAT constraint model and
its infeasibility diagnostics, the 21 independent validator rules, the
SQLAlchemy academic schema, and the full test suites for each.
