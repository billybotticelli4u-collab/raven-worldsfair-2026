#!/usr/bin/env node
// Emit more than maxBuffer to trigger excess output → incomplete, not REJECT MATCH
const chunk = Buffer.alloc(8192, 0x41);
for (let i = 0; i < 20; i++) process.stdout.write(chunk);
