/**
 * OCPP Health Monitoring Service
 * Monitors charger connections and alerts on issues
 */

export class OcppHealthService {
  constructor() {
    this.chargerStatus = new Map();
    this.alerts = [];
  }
  
  checkChargerHealth(chargerId) {
    const charger = chargerMetadata.get(chargerId);
    const now = new Date();
    
    if (!charger) {
      return { healthy: false, reason: 'No metadata' };
    }
    
    // Check last heartbeat
    if (charger.lastHeartbeat) {
      const timeSinceHeartbeat = now - new Date(charger.lastHeartbeat);
      if (timeSinceHeartbeat > 3600000) { // 1 hour
        return { 
          healthy: false, 
          reason: `No heartbeat for ${Math.floor(timeSinceHeartbeat / 60000)} minutes` 
        };
      }
    }
    
    // Check last message
    if (charger.lastMessageAt) {
      const timeSinceMessage = now - new Date(charger.lastMessageAt);
      if (timeSinceMessage > 300000) { // 5 minutes
        return { 
          healthy: false, 
          reason: `No messages for ${Math.floor(timeSinceMessage / 60000)} minutes` 
        };
      }
    }
    
    return { healthy: true };
  }
  
  getAllChargerHealth() {
    const results = [];
    
    for (const [chargerId, metadata] of chargerMetadata.entries()) {
      const health = this.checkChargerHealth(chargerId);
      results.push({
        chargerId,
        ...health,
        metadata: {
          connectedAt: metadata.connectedAt,
          lastHeartbeat: metadata.lastHeartbeat,
          lastMessageAt: metadata.lastMessageAt,
          ocppVersion: metadata.ocppVersion,
        },
      });
    }
    
    return results;
  }
  
  logHealthStatus() {
    const healthStatus = this.getAllChargerHealth();
    const healthy = healthStatus.filter(h => h.healthy);
    const unhealthy = healthStatus.filter(h => !h.healthy);
    
    console.log(`[OCPP-HEALTH] Total: ${healthStatus.length}, Healthy: ${healthy.length}, Unhealthy: ${unhealthy.length}`);
    
    if (unhealthy.length > 0) {
      console.log('[OCPP-HEALTH] Unhealthy chargers:');
      unhealthy.forEach(ch => {
        console.log(`  ${ch.chargerId}: ${ch.reason}`);
      });
    }
  }
}

// Singleton instance
export const ocppHealth = new OcppHealthService();

// Run health check every 5 minutes
setInterval(() => {
  ocppHealth.logHealthStatus();
}, 300000);