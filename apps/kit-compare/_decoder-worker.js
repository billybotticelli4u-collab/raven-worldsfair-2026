'use strict';
const versions = ['3.0.3', '4.0.0', '8.3.0'];
const kits = versions.map(version => { importScripts(`decoder-vendor/kit-${version}.js`); return self.solanaWeb3; });
self.onmessage = event => {
  const bytes = new Uint8Array(event.data);
  const results = kits.map((kit, i) => {
    try {
      const transaction = kit.getTransactionDecoder().decode(bytes);
      const message = kit.getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
      return {library:'@solana/kit', version:versions[i], decision:'ACCEPT', decodedVersion:message.version, detail:'Transaction and compiled-message decoder both returned.'};
    } catch(error) {
      return {library:'@solana/kit', version:versions[i], decision:'REJECT', decodedVersion:null, detail:String(error.message).slice(0,1000), code:error.context?.__code ?? null};
    }
  });
  self.postMessage(results);
};
