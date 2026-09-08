param name string
param location string
param tags object
param administratorLogin string
@secure()
param administratorPassword string
@minLength(1)
param allowedAddresses array

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '17'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
    storage: { storageSizeGB: 32, autoGrow: 'Disabled', type: 'Premium_LRS' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: server
  name: 'caesai'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource firewallRules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = [for address in allowedAddresses: {
  parent: server
  name: 'app-${replace(address, '.', '-')}'
  properties: { startIpAddress: address, endIpAddress: address }
}]
