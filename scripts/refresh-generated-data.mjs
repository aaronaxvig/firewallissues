#!/usr/bin/env node
import { runUpdateProductsCli } from './update-products-from-issues.mjs';
import { generateRenderedFixtures } from './generate-rendered-fixtures.mjs';

await runUpdateProductsCli();
const fixtureResult = generateRenderedFixtures();
console.log(`Regenerated ${fixtureResult.fixtures} rendered fixture set(s).`);
