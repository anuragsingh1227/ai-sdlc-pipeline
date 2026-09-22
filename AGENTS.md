# Agents

This control plane sequences work with `pipeline.yaml`. Workers read files. They do not share chat memory.

- Run `npx tsx src/cli.ts status <feature-id>` or `npx tsx src/cli.ts run --run runs/<feature-id> --dry-run` and do only that stage.
- Role prompts live in `agents/<role>/SYSTEM.md`. Contracts are summarized in `docs/AGENTS.md`.
- Critics never implement. Implementers never self-approve. Humans merge.
- Product edits follow `.cursor/rules/java-react-ecs.mdc` unless the product repo already has a stricter pattern.
