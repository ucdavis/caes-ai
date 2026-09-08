targetScope = 'resourceGroup'

@secure()
@minLength(32)
param postgresAdminPassword string

@secure()
@minLength(1)
param openAiApiKey string

@secure()
@minLength(1)
@description('Version 1 callback key ring JSON. Preserve this secret across deployments.')
param callbackSigningKeysJson string

param defaultModel string = 'gpt-5.6-luna'
param allowedModels string = defaultModel
param otelEndpoint string = ''
@secure()
param otelHeaders string = ''

// This template deliberately cannot provision production or modify the shared plan.
var guardPassed = subscription().subscriptionId == '105dede4-4731-492e-8c28-5121226319b0' && tenant().tenantId == 'a8046f64-66c0-4f00-9046-c8daf92ff62b' && resourceGroup().name == 'rg-caes-ai-test'
var location = 'westus2'
var token = take(uniqueString(resourceGroup().id, 'caes-ai'), 6)
var webAppName = 'web-caes-ai-test-${token}'
var postgresName = 'pg-caes-ai-test-${token}'
var tags = { application: 'caes-ai', environment: 'test' }
var postgresLogin = 'caesaiadmin'
var databaseUrl = 'postgresql://${postgresLogin}:${uriComponent(postgresAdminPassword)}@${postgresName}.postgres.database.azure.com:5432/caesai?sslmode=verify-full'

resource sharedPlan 'Microsoft.Web/serverfarms@2024-11-01' existing = {
  name: 'DefaultPlan2'
  scope: resourceGroup('Default-Web-WestUS')
}

resource webApp 'Microsoft.Web/sites@2024-11-01' = if (guardPassed) {
  name: webAppName
  location: location
  kind: 'app,linux'
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: sharedPlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node scripts/azure/start-server.mjs'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/ready'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'NODE_OPTIONS', value: '--max-old-space-size=256' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'CAES_AI_HOST', value: '0.0.0.0' }
        { name: 'CAES_AI_PORT', value: '8080' }
        { name: 'CAES_AI_PUBLIC_BASE_URL', value: 'https://${webAppName}.azurewebsites.net' }
        { name: 'CAES_AI_CALLBACK_ISSUER', value: 'https://${webAppName}.azurewebsites.net' }
        { name: 'CAES_AI_CALLBACK_SIGNING_KEYS_JSON', value: callbackSigningKeysJson }
        { name: 'OPENAI_API_KEY', value: openAiApiKey }
        { name: 'OPENAI_DEFAULT_MODEL', value: defaultModel }
        { name: 'OPENAI_ALLOWED_MODELS', value: allowedModels }
        { name: 'DATABASE_URL', value: databaseUrl }
        { name: 'CAES_AI_OTEL_ENABLED', value: empty(otelEndpoint) ? 'false' : 'true' }
        { name: 'OTEL_SERVICE_NAME', value: 'caes-ai.test' }
        { name: 'OTEL_RESOURCE_ATTRIBUTES', value: 'deployment.environment.name=test,service.namespace=caes-ai' }
        { name: 'OTEL_EXPORTER_OTLP_PROTOCOL', value: 'http/protobuf' }
        { name: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: otelEndpoint }
        { name: 'OTEL_EXPORTER_OTLP_HEADERS', value: otelHeaders }
      ]
    }
  }
}

resource ftpPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = if (guardPassed) {
  parent: webApp
  name: 'ftp'
  properties: { allow: false }
}

resource scmPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = if (guardPassed) {
  parent: webApp
  name: 'scm'
  properties: { allow: false }
}

module postgres 'modules/postgres.bicep' = if (guardPassed) {
  name: 'postgres-test'
  params: {
    name: postgresName
    location: location
    tags: tags
    administratorLogin: postgresLogin
    administratorPassword: postgresAdminPassword
    // Only this App Service's possible outbound addresses can reach PostgreSQL.
    allowedAddresses: split(webApp!.properties.possibleOutboundIpAddresses, ',')
  }
}

output deploymentGuardPassed bool = guardPassed
output webAppName string = guardPassed ? webApp!.name : ''
output appUrl string = guardPassed ? 'https://${webAppName}.azurewebsites.net' : ''
output postgresServerName string = guardPassed ? postgresName : ''
