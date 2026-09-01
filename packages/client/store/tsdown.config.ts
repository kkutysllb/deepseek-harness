import { staticLinked } from '../tsdown.client.ts'

export default staticLinked(
  '@qilin/client-store',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
