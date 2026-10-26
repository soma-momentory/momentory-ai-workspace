import {installCodexProfiles} from '../src/codexProfile.mjs';
import {loadEnv} from '../src/config.mjs';
loadEnv();
installCodexProfiles();
console.log('Installed and verified Codex filesystem isolation profiles in CODEX_HOME.');
