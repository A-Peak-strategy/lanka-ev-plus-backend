import { v4 as uuid } from "uuid";

export function generateTransactionId(chargerId) {
  // const now = new Date();
  // const timestamp = now
  //   .toISOString()          
  //   .replace(/[-:.TZ]/g, ""); 

  // return `${timestamp}`;

    return uuid();

}
