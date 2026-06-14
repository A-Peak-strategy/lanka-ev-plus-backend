/**
 * Utility functions for time-based operations
 */

/**
 * Determines the current pricing tier based on Sri Lanka Standard Time (Asia/Colombo).
 * Peak: 18:30 to 22:30
 * Day: 05:30 to 18:30
 * Off-Peak: 22:30 to 05:30
 * 
 * @param {Date} date - The date/time to check
 * @returns {string} - "PEAK", "DAY", or "OFF_PEAK"
 */
export function getCurrentPricingTier(date = new Date()) {
  // Use Intl.DateTimeFormat to reliably extract hours and minutes in Colombo timezone
  const options = {
    timeZone: 'Asia/Colombo',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  };

  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);
  
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);

  // Convert time to minutes from midnight for easier comparison
  const timeInMinutes = hour * 60 + minute;

  // Define thresholds in minutes
  const t0530 = 5 * 60 + 30; // 330
  const t1830 = 18 * 60 + 30; // 1110
  const t2230 = 22 * 60 + 30; // 1350

  if (timeInMinutes >= t0530 && timeInMinutes < t1830) {
    return 'DAY';
  } else if (timeInMinutes >= t1830 && timeInMinutes < t2230) {
    return 'PEAK';
  } else {
    // 22:30 to 05:30
    return 'OFF_PEAK';
  }
}
