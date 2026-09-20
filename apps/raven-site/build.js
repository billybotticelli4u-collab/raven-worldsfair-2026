// Injects evidence/*.compact.json into templates -> built pages.
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const evidence = {};
for (const n of ["usdc", "fresh-pump", "risk-pump"]) {
  evidence[n] = JSON.parse(fs.readFileSync(path.join(dir, "evidence", n + ".compact.json")));
}
const blob = JSON.stringify(evidence).replace(/</g, "\\u003c");
for (const page of ["index", "receipts"]) {
  const tpl = fs.readFileSync(path.join(dir, page + ".template.html"), "utf8");
  fs.writeFileSync(path.join(dir, page + ".html"), tpl.replace("__EVIDENCE__", () => blob));
  console.log("built " + page + ".html");
}
