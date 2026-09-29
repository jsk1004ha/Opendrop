// Render publishes the repository root. Do not publish cached browser binaries,
// temporary screenshots, or dependency trees from previous verification builds.
import { rm } from 'node:fs/promises';
if (process.env.RENDER) {
  for (const path of ['node_modules', 'qa/node_modules', '_qa']) {
    await rm(path, { recursive: true, force: true });
  }
  console.log('OPENDROP_PUBLISH: static assets only; runtime dependencies: 0');
}
