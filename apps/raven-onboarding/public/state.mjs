/** Cancellation alone is insufficient: old promises may still resolve. */
export function createRunState() {
  let generation = 0, result = null, controller = null;
  return {
    invalidate() { generation++; controller?.abort(); controller = null; result = null; },
    start() { this.invalidate(); controller = new AbortController(); return { generation, signal: controller.signal }; },
    current(ticket) { return ticket.generation === generation && !ticket.signal.aborted; },
    accept(ticket, value) { if (!this.current(ticket)) return false; result = value; return true; },
    get result() { return result; },
  };
}

export function decodeInput(text, encoding) {
  const input = text.replace(/\s/g, '');
  if (!input) throw Error('Enter transaction bytes or choose an example.');
  let bytes;
  if (encoding === 'hex') {
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(input)) throw Error('Hex needs complete byte pairs using 0–9 and A–F.');
    bytes = Uint8Array.from(input.match(/../g), b => parseInt(b, 16));
  } else if (encoding === 'base64') {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) throw Error('Use canonical, padded base64.');
    const raw = atob(input);
    if (btoa(raw) !== input) throw Error('Base64 is not canonical.');
    bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  } else throw Error('Choose hex or base64.');
  if (bytes.length > 4096) throw Error('The browser comparison is limited to 4,096 bytes.');
  return bytes;
}
