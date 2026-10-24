# spacetime/

SpacetimeDB TypeScript module for Maincloud (AGENTS.md §9). Scaffolded with
`spacetime init --lang typescript` (CLI 2.13). Module source: `spacetimedb/src/index.ts`
(still the template; the schema is written and frozen in the Foundation phase).

`docs/` holds SpacetimeDB's own agent rules from the template — read them before
editing the module. Avoid HTTP handlers, views and RLS.

Build: `cd spacetimedb && npm run build`. Publish needs `spacetime login` first.
