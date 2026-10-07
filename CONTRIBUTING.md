# Contributing

Issues and pull requests are welcome.

```bash
npm install
npm run verify      # typecheck, tests, the Paseo Cafe pre-check, the changelog check
npm pack --dry-run  # what would be published
```

| Before opening a pull request | |
| --- | --- |
| A behaviour change has a test | The tests use a stand-in `claude` (`test/stub/claude`); they never touch a real install or the network. |
| A change a user would notice has a line in `CHANGELOG.md` | Under `## Unreleased` at the top. Leave the version in `package.json` alone; it changes in the release pull request. |
| `npm run verify` passes | CI runs the same on Linux and macOS, Node 22 and 24. |

Never run `claude update` against your real install while developing. [AGENTS.md](AGENTS.md) has
the layout, the conventions and how to try the plugin against a throwaway home;
[RELEASING.md](RELEASING.md) has how a release is cut. Security problems go through
[SECURITY.md](SECURITY.md), not a public issue.
