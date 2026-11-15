// EMBERLINE's entrypoint (Node 22, standard library only). It hands the game
// in: it copies this repository's game/ and screenshots/ into the output
// directory and writes /output/dossier.json with the kit's vendored library,
// which the scorer rebuilds byte for byte. Run it locally with
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// and serve game/ with `node serve.ts` to play it at http://localhost:8080.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's caps, from the kit's gate: at most 4 screenshots of 256 KiB,
// game/ at most 993 entries and 48 MiB, and the dossier's source text at
// most 163,840 bytes. buildDossier enforces them here so a bad entry fails
// loudly on my machine instead of silently at the gate.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
