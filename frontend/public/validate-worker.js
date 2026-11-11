import init, { validate_vcf } from '/wasm/fastvep_wasm.js';
const ready = init();
self.onmessage = async ({ data }) => {
  try { await ready; self.postMessage({ id:data.id, count:validate_vcf(data.vcf) }); }
  catch (error) { self.postMessage({ id:data.id, error:String(error) }); }
};
