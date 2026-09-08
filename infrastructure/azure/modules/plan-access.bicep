param principalId string

resource plan 'Microsoft.Web/serverfarms@2024-11-01' existing = {
  name: 'DefaultPlan2'
}

resource access 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(plan.id, principalId, 'web-plan-contributor')
  scope: plan
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2cc479cb-7b4d-49a8-b449-8c00fd0f0a4b')
  }
}
