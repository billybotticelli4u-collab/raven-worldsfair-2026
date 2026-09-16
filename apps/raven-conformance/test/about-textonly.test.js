import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("..", import.meta.url));
const HOSTILE = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;

function loadAppSource() {
  return readFileSync(path.join(APP, "public/app.js"), "utf8");
}

function makeDom() {
  let unsafe = 0;
  const listeners = new Map();
  class El {
    constructor(id) {
      this.id = id;
      this.tagName = (id || "div").toUpperCase();
      this.children = [];
      this.ownText = "";
      this.className = "";
      this.classList = {
        _s: new Set(),
        add(...xs) { xs.forEach((x) => this._s.add(x)); },
        remove(...xs) { xs.forEach((x) => this._s.delete(x)); },
        toggle(x, on) { if (on) this._s.add(x); else this._s.delete(x); },
        contains(x) { return this._s.has(x); },
      };
      this.style = {};
      this.dataset = {};
      this.disabled = false;
      this._listeners = [];
    }
    get textContent() {
      return this.ownText + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
    }
    set textContent(v) {
      this.ownText = v == null ? "" : String(v);
      this.children = [];
    }
    set innerHTML(value) {
      if (value !== "") {
        unsafe += 1;
        throw new Error("untrusted HTML sink on #" + this.id + ": " + String(value).slice(0, 80));
      }
      this.children = [];
      this.ownText = "";
    }
    get innerHTML() {
      return this.ownText;
    }
    get childElementCount() {
      return this.children.filter((c) => c && typeof c === "object").length;
    }
    append(...kids) { this.children.push(...kids); }
    appendChild(c) { this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
    get firstChild() { return this.children[0] || null; }
    addEventListener(type, fn) {
      this._listeners.push({ type, fn });
      const key = this.id + ":" + type;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    }
    setAttribute() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    showModal() { this._open = true; }
    click() {
      for (const { type, fn } of this._listeners) if (type === "click") fn({});
    }
  }
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, new El(id));
    return elements.get(id);
  };
  // Pre-create all IDs app.js expects
  for (const id of [
    "targetRow","targetBlurb","runBtn","recordedBtn","metaKv","corpusScopeNote","overall","summaryLine",
    "countKv","idKv","vectorList","failurePre","reproPre","copyBtn","downloadBtn","aboutBtn","aboutDialog",
    "aboutBody","progressBar","progressText","progressLog","sourceBanner","errorBanner","issuePanel",
    "liveRegion","alertRegion","body",
  ]) byId(id);
  return {
    elements,
    byId,
    listeners,
    unsafe: () => unsafe,
    document: {
      getElementById: byId,
      createElement: (tag) => new El(tag),
      body: byId("body"),
    },
  };
}

describe("About/build text-only product regression", () => {
  it("production About path uses textOnly — no aboutBody.innerHTML assignment", () => {
    const src = loadAppSource();
    assert.doesNotMatch(src, /aboutBody\.innerHTML\s*=/);
    assert.match(src, /clear\(els\.aboutBody\)/);
    assert.match(src, /els\.aboutBtn\.addEventListener/);
  });

  it("drives hostile owned strings through real public/app.js About handler", async () => {
    const src = loadAppSource();
    const dom = makeDom();
    const buildInfo = {
      fairBuildCommit: HOSTILE,
      fairBuildBranch: HOSTILE,
      buildStageNote: HOSTILE,
      labels: { fairBuilt: HOSTILE, preexisting: HOSTILE },
      fairBuilt: [HOSTILE, "normal-fair-item"],
      preexisting: [HOSTILE],
      officialContestStart: { instant: HOSTILE, zone: HOSTILE },
    };
    const sandbox = {
      document: dom.document,
      window: { __xss: undefined },
      fetch: async (url) => {
        const u = String(url);
        if (u.includes("/api/build-info")) return { ok: true, json: async () => buildInfo };
        if (u.includes("/api/targets")) return { ok: true, json: async () => ({ targets: [] }) };
        if (u.includes("/api/meta")) return { ok: true, json: async () => ({ profile: null, corpus: null }) };
        if (u.includes("/api/health")) return { ok: true, json: async () => ({ ok: true }) };
        return { ok: true, json: async () => ({}) };
      },
      sessionStorage: { getItem: () => null, setItem() {} },
      EventSource: class { close() {} addEventListener() {} get readyState() { return 2; } },
      navigator: { clipboard: { writeText: async () => {} } },
      URL: Object.assign(class {
        constructor(u) { this.href = String(u); }
      }, { createObjectURL() { return "blob:x"; }, revokeObjectURL() {} }),
      Blob: class {},
      console,
      setTimeout: (fn) => fn(),
    };

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    // Execute real app.js with DOM/fetch stubs; defer boot's unhandled rejection noise.
    const code =
      `const document = sandbox.document;\n` +
      `const window = sandbox.window;\n` +
      `const fetch = sandbox.fetch.bind(sandbox);\n` +
      `const sessionStorage = sandbox.sessionStorage;\n` +
      `const EventSource = sandbox.EventSource;\n` +
      `const navigator = sandbox.navigator;\n` +
      `const URL = sandbox.URL;\n` +
      `const Blob = sandbox.Blob;\n` +
      `const setTimeout = sandbox.setTimeout;\n` +
      src;
    await new AsyncFunction("sandbox", code)(sandbox);

    // Invoke the real About click listener registered by app.js
    const aboutBtn = dom.byId("aboutBtn");
    assert.ok(aboutBtn._listeners.some((l) => l.type === "click"), "about listener registered");
    await aboutBtn.click();
    // click handler is async — allow microtasks
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(dom.unsafe(), 0, "innerHTML sink must not fire");
    assert.equal(sandbox.window.__xss, undefined);
    const about = dom.byId("aboutBody");
    assert.ok(about.textContent.includes("<script>"), "hostile markup retained as text");
    assert.ok(about.textContent.includes("onerror"), "hostile attrs retained as text");
    assert.ok(about.textContent.includes(HOSTILE.slice(0, 12)));
    assert.ok(about.childElementCount >= 1, "structured nodes via createElement only");
    // Ensure no parsed <script>/<img> element tags were created from HTML strings
    const tags = [];
    const walk = (el) => {
      for (const c of el.children || []) {
        if (c && c.tagName) tags.push(c.tagName);
        walk(c);
      }
    };
    walk(about);
    assert.ok(!tags.includes("SCRIPT"));
    assert.ok(!tags.includes("IMG"));
  });

  it("disposable innerHTML mutant fails this regression for the intended reason (red)", () => {
    const src = loadAppSource();
    const mutant = src
      .replace(
        /clear\(els\.aboutBody\);/,
        `els.aboutBody.innerHTML = "";`,
      )
      .replace(
        /const addP = \(text\) => \{ const p = document\.createElement\("p"\); textOnly\(p, text\); els\.aboutBody\.appendChild\(p\); \};/,
        `const addP = (text) => { els.aboutBody.innerHTML += "<p>" + text + "</p>"; };`,
      );
    assert.notEqual(mutant, src);
    // The product regression predicate:
    const productionOk = !/aboutBody\.innerHTML\s*=/.test(src);
    const mutantOk = !/aboutBody\.innerHTML\s*=/.test(mutant);
    assert.equal(productionOk, true);
    assert.equal(mutantOk, false, "mutant must fail because aboutBody.innerHTML sink was restored");

    // Also execute mutant under DOM that throws on innerHTML — proves failure reason.
    const dom = makeDom();
    const sandbox = {
      document: dom.document,
      window: {},
      fetch: async () => ({
        ok: true,
        json: async () => ({
          fairBuildCommit: HOSTILE,
          fairBuildBranch: "b",
          buildStageNote: "n",
          labels: {},
          fairBuilt: [HOSTILE],
          preexisting: [],
          officialContestStart: { instant: "i", zone: "z" },
        }),
      }),
      sessionStorage: { getItem: () => null, setItem() {} },
      EventSource: class { close() {} addEventListener() {} },
      navigator: { clipboard: { writeText: async () => {} } },
      URL: Object.assign(class { constructor(u) { this.href = String(u); } }, {
        createObjectURL() { return "blob:x"; },
        revokeObjectURL() {},
      }),
      Blob: class {},
      console,
      setTimeout: (fn) => fn(),
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const code =
      `const document = sandbox.document;\n` +
      `const window = sandbox.window;\n` +
      `const fetch = sandbox.fetch;\n` +
      `const sessionStorage = sandbox.sessionStorage;\n` +
      `const EventSource = sandbox.EventSource;\n` +
      `const navigator = sandbox.navigator;\n` +
      `const URL = sandbox.URL;\n` +
      `const Blob = sandbox.Blob;\n` +
      `const setTimeout = sandbox.setTimeout;\n` +
      mutant;
    return new AsyncFunction("sandbox", code)(sandbox).then(async () => {
      let failedForInnerHTML = false;
      try {
        await dom.byId("aboutBtn").click();
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
      } catch (err) {
        failedForInnerHTML = /untrusted HTML sink/i.test(String(err));
      }
      assert.equal(failedForInnerHTML || dom.unsafe() > 0, true, "mutant must trip innerHTML sink");
    });
  });
});
