import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

const parameters = {};
for (const [parameter, variable] of Object.entries({
  postgresAdminPassword: 'POSTGRES_ADMIN_PASSWORD',
  openAiApiKey: 'OPENAI_API_KEY',
  callbackSigningKeysJson: 'CALLBACK_SIGNING_KEYS_JSON',
})) {
  assert.ok(process.env[variable], `Missing GitHub test environment secret: ${variable}`);
  parameters[parameter] = { value: process.env[variable] };
}
for (const [parameter, variable] of Object.entries({
  defaultModel: 'OPENAI_DEFAULT_MODEL',
  allowedModels: 'OPENAI_ALLOWED_MODELS',
  otelEndpoint: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  otelHeaders: 'OTEL_EXPORTER_OTLP_HEADERS',
})) {
  if (process.env[variable]) parameters[parameter] = { value: process.env[variable] };
}
assert.ok(process.argv[2], 'Provide a parameter file path outside the checkout.');
writeFileSync(process.argv[2], JSON.stringify({ parameters }), { mode: 0o600 });
