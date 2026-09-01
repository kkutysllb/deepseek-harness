#!/usr/bin/env node
// tsdown's workspace batch includes the repository root manifest as a project;
// the root owns no compilable source, so materialize the empty host entries the
// shared entry glob expects instead of teaching every package about the root.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

mkdirSync('lib/types', { recursive: true })
for (const name of ['index', 'invariant', 'startup']) {
  writeFileSync(join('lib/types', `${name}.js`), '// The repository root is not a buildable package.\nexport {}\n')
}
