/**
 * OCPP Message Logger
 * Logs all OCPP messages with detailed formatting
 */

export function logOcppMessage(chargerId, direction, action, messageId, payload, response = null) {
    const timestamp = new Date().toISOString();
    const arrow = direction === 'INCOMING' ? '←' : '→';

    // Format the log message
    const logMessage = `[OCPP] ${timestamp} ${chargerId} ${arrow} ${action}`;

    // Color coding for different message types
    const colors = {
        'INCOMING': '\x1b[36m', // Cyan
        'OUTGOING': '\x1b[32m', // Green
        'ERROR': '\x1b[31m',    // Red
        'RESPONSE': '\x1b[33m', // Yellow
    };

    const color = colors[direction] || '\x1b[0m';
    const reset = '\x1b[0m';

    console.log(`${color}${logMessage}${reset}`);

    // Log message details if in debug mode
    if (process.env.OCPP_DEBUG === 'true') {
        console.log(`  Message ID: ${messageId}`);
        console.log(`  Payload:`, JSON.stringify(payload, null, 2));
        if (response) {
            console.log(`  Response:`, JSON.stringify(response, null, 2));
        }
    }
}

/**
 * Log connection events
 */
export function logConnectionEvent(event, chargerId, details = {}) {
    const timestamp = new Date().toISOString();

    const eventColors = {
        'CONNECT': '\x1b[32m',    // Green
        'DISCONNECT': '\x1b[31m', // Red
        'RECONNECT': '\x1b[33m',  // Yellow
        'ERROR': '\x1b[35m',      // Magenta
    };

    const color = eventColors[event] || '\x1b[0m';
    const reset = '\x1b[0m';

    const message = `[OCPP-CONNECTION] ${timestamp} ${chargerId} ${event}`;
    console.log(`${color}${message}${reset}`);

    if (Object.keys(details).length > 0) {
        console.log(`  Details:`, details);
    }
}

/**
 * Log transaction lifecycle
 */
export function logTransactionEvent(transactionId, event, details = {}) {
    const timestamp = new Date().toISOString();

    console.log(`[OCPP-TRANSACTION] ${timestamp} ${transactionId} ${event}`);

    if (Object.keys(details).length > 0) {
        console.log(`  Details:`, details);
    }
}