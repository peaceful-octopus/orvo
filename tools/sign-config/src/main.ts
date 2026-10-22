import fs from 'node:fs';
import { run } from './cli';

process.exitCode = run(process.argv.slice(2), {
  readFile: (path) => fs.readFileSync(path, 'utf8'),
  writeFile: (path, content) => fs.writeFileSync(path, content),
  env: process.env,
  now: Date.now,
  out: (line) => console.log(line),
});
