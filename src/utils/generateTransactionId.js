// import { v4 as uuid } from "uuid";

// export function generateTransactionId(chargerId) {
//   // const now = new Date();
//   // const timestamp = now
//   //   .toISOString()          
//   //   .replace(/[-:.TZ]/g, ""); 

//   // return `${chargerId}-${timestamp}`;
//   return uuid();
// }


let txCounter = 1;

export function generateTransactionId() {
  return txCounter++;
}