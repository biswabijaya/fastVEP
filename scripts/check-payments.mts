// Read-only: this deliberately nonexistent reference never creates a payment.
import { apsConfig, checkPayment } from '../frontend/src/server/aps.ts';
try {
  const config=await apsConfig();
  const response=await checkPayment('fastvep-config-check-no-purchase',config);
  if(response.response_code!=='12036')throw new Error('Unexpected configuration probe result');
  console.log('APS production request accepted; response signature verified; no purchase attempted.');
} catch {
  console.error('Payment configuration verification failed. Check the signing settings and Secret Manager access. No purchase was attempted.');
  process.exitCode=1;
}
