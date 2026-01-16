const PACKAGE_NAME = 'form0-core';

const npmUserAgent = process.env.npm_config_user_agent || '';
const npmArgv = process.env.npm_config_argv;

const isSupportedManager = /(npm|pnpm|yarn|bun)\//.test(npmUserAgent);

const parseNpmArgv = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const includesExplicitPackage = (argv) => {
  if (!argv) return false;
  const args = Array.isArray(argv.original) ? argv.original : argv.cooked || [];
  return args.some(
    (arg) => arg === PACKAGE_NAME || arg.startsWith(`${PACKAGE_NAME}@`),
  );
};

if (isSupportedManager && includesExplicitPackage(parseNpmArgv(npmArgv))) {
  // Keep message short to avoid noisy installs.
  console.warn(
    [
      '',
      'form0-core is the engine only.',
      'For the full form0 ecosystem, install the CLI:',
      '  npm install -g form0-cli',
      'Docs: https://docs.form0.dev/getting-started/quickstart',
      'If you are integrating the engine directly, you can ignore this warning.',
      '',
    ].join('\n'),
  );
}
