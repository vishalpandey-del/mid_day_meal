import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

/**
 * Writes MONGO_URI into .env, URL-encoding the credentials so passwords
 * containing @ : / ? & # do not corrupt the connection string.
 *
 *   npm run db:set                       (prompts; password is not echoed)
 *   npm run db:set -- --user U --pass P  (non-interactive)
 *
 * Credentials passed as flags land in shell history — prefer the prompts.
 */
const ENV = path.resolve(process.cwd(), '.env');
const DEFAULT_CLUSTER = 'middaymeal.37tdil3.mongodb.net';
const DEFAULT_DB = 'vidyaposhan';

const mask = (uri) => uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');

/** Reads --key value pairs after the script name. */
const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1]?.startsWith('--') ? '' : argv[++i] ?? '';
  }
  return out;
};

/** Prompt that hides typed characters, for the password. */
const secret = async (rl, label) => {
  const onKeypress = (char) => {
    if (char === '\n' || char === '\r' || char === '') return;
    // Redraw the prompt without the typed text.
    process.stdout.write(`[2K[200D${label}`);
  };
  process.stdin.on('data', onKeypress);
  try {
    return await rl.question(label);
  } finally {
    process.stdin.removeListener('data', onKeypress);
    process.stdout.write('\n');
  }
};

const run = async () => {
  if (!fs.existsSync(ENV)) {
    console.error('[db] .env not found. Copy .env.example to .env first.');
    process.exit(1);
  }

  const args = parseArgs();
  let cluster = args.cluster || process.env.ATLAS_CLUSTER || '';
  let user = args.user || process.env.ATLAS_USER || '';
  let pass = args.pass || process.env.ATLAS_PASS || '';
  let dbName = args.db || process.env.ATLAS_DB || '';

  const needsPrompt = !user || !pass;
  if (needsPrompt) {
    if (!process.stdin.isTTY) {
      console.error('[db] No terminal available for prompts.');
      console.error('     Use: npm run db:set -- --user <name> --pass <password>');
      console.error('     Or set ATLAS_USER / ATLAS_PASS in the environment.');
      process.exit(1);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      cluster = cluster || (await rl.question(`Atlas cluster host [${DEFAULT_CLUSTER}]: `)).trim();
      user = user || (await rl.question('Database username: ')).trim();
      pass = pass || (await secret(rl, 'Database password: ')).trim();
      dbName = dbName || (await rl.question(`Database name [${DEFAULT_DB}]: `)).trim();
    } finally {
      rl.close();
    }
  }

  cluster = cluster || DEFAULT_CLUSTER;
  dbName = dbName || DEFAULT_DB;

  if (!user || !pass) {
    console.error('[db] Username and password are both required.');
    process.exit(1);
  }

  const uri =
    `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}` +
    `@${cluster}/${dbName}?retryWrites=true&w=majority&appName=middaymeal`;

  const current = fs.readFileSync(ENV, 'utf8');
  const next = /^MONGO_URI=/m.test(current)
    ? current.replace(/^MONGO_URI=.*$/m, `MONGO_URI=${uri}`)
    : `${current.trimEnd()}\nMONGO_URI=${uri}\n`;

  fs.writeFileSync(ENV, next);
  console.log(`[db] .env updated → ${mask(uri)}`);
  console.log('[db] next: npm run db:check');
};

run().catch((err) => {
  console.error('[db] failed:', err.message);
  process.exit(1);
});
