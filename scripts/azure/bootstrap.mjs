import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

// New environments need an explicitly reviewed template and target configuration.
const targets = new Map([['test', {
  subscription: '105dede4-4731-492e-8c28-5121226319b0',
  tenant: 'a8046f64-66c0-4f00-9046-c8daf92ff62b',
  location: 'westus2',
  resourceGroup: 'rg-caes-ai-test',
  template: '../../infrastructure/azure/bootstrap.bicep',
}]]);
const repo = 'ucdavis/caes-ai';
const usage = 'Usage: npm run azure:bootstrap -- <environment> <--what-if|--apply>\nConfigured environments: test\n';

function json(command, args) {
  return JSON.parse(execFileSync(command, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  }));
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(usage);
    return;
  }
  const [environment, mode] = args;
  const target = targets.get(environment);
  if (args.length !== 2 || !target || !['--what-if', '--apply'].includes(mode)) {
    throw new Error(usage.trim());
  }

  // Check the explicit subscription without changing the developer's default account.
  const account = json('az', ['account', 'show', '--subscription', target.subscription, '--output', 'json']);
  if (account.id !== target.subscription || account.tenantId !== target.tenant || account.state !== 'Enabled') {
    throw new Error('Azure account does not match the configured subscription and tenant, or is disabled.');
  }
  if (mode === '--apply') {
    // Fail before provisioning if the destination environment is missing or inaccessible.
    json('gh', ['api', `repos/${repo}/environments/${environment}`]);
  }
  process.stdout.write(`${mode}: ${repo}, environment ${environment}, subscription ${target.subscription}, resource group ${target.resourceGroup}\n`);
  const deploymentArgs = [
    'deployment', 'sub', mode === '--apply' ? 'create' : 'what-if',
    '--subscription', target.subscription, '--location', target.location,
    '--name', `caes-ai-${environment}-bootstrap`,
    '--template-file', fileURLToPath(new URL(target.template, import.meta.url)),
  ];
  if (mode === '--what-if') {
    execFileSync('az', deploymentArgs, { stdio: 'inherit' });
    return;
  }

  const outputs = json('az', [...deploymentArgs, '--query', 'properties.outputs', '--output', 'json']);
  const clientId = outputs.clientId?.value;
  if (outputs.deploymentGuardPassed?.value !== true || outputs.resourceGroup?.value !== target.resourceGroup ||
      typeof clientId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new Error('Bootstrap outputs did not match the configured target; GitHub was not updated.');
  }
  process.stdout.write(`Azure bootstrap complete. Deployment client ID: ${clientId}\n`);
  try {
    execFileSync('gh', ['variable', 'set', 'AZURE_CLIENT_ID', '--repo', repo, '--env', environment, '--body', clientId], { stdio: 'inherit' });
  } catch {
    throw new Error(`Azure is ready, but saving AZURE_CLIENT_ID failed. Rerun this command or set ${clientId} in the ${environment} GitHub environment.`);
  }
  process.stdout.write(`Saved AZURE_CLIENT_ID in GitHub environment ${environment}. Next, run Deploy Azure ${environment} with configure_infrastructure=true.\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
