param federatedSubject string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-caes-ai-github-test'
  location: resourceGroup().location
  tags: { application: 'caes-ai', environment: 'test' }
}

resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2024-11-30' = {
  parent: identity
  name: 'github-test'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: federatedSubject
    audiences: ['api://AzureADTokenExchange']
  }
}

resource contributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, identity.id, 'contributor')
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
  }
}

output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId
