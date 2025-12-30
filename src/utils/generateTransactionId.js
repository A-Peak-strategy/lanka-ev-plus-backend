export function generateTransactionId(chargerId) {
  const now = new Date();
  const timestamp = now
    .toISOString()          
    .replace(/[-:.TZ]/g, ""); 

  return `${chargerId}-${timestamp}`;
}
