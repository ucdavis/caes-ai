targetScope = 'subscription'

@description('Exact test environment subject emitted by GitHub. This repository uses the default format with immutable owner and repository IDs.')
@allowed(['repo:ucdavis@573450/caes-ai@1357492545:environment:test'])
param federatedSubject string = 'repo:ucdavis@573450/caes-ai@1357492545:environment:test'

var guardPassed = subscription().subscriptionId == '105dede4-4731-492e-8c28-5121226319b0' && tenant().tenantId == 'a8046f64-66c0-4f00-9046-c8daf92ff62b'

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = if (guardPassed) {
  name: 'rg-caes-ai-test'
  location: 'westus2'
  tags: { application: 'caes-ai', environment: 'test' }
}

module identity 'modules/deployment-identity.bicep' = if (guardPassed) {
  name: 'caes-ai-test-identity'
  scope: group
  params: { federatedSubject: federatedSubject }
}

// Plan access is restricted to the one user-selected plan, not its resource group.
module planAccess 'modules/plan-access.bicep' = if (guardPassed) {
  name: 'caes-ai-test-plan-access'
  scope: resourceGroup('Default-Web-WestUS')
  params: { principalId: identity!.outputs.principalId }
}

output deploymentGuardPassed bool = guardPassed
output clientId string = guardPassed ? identity!.outputs.clientId : ''
output resourceGroup string = guardPassed ? group!.name : ''
