const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const homePages = ['index.html', 'xiaohonghua_v8a.html'];

for (const page of homePages) {
  test(`${page} refreshes event data when a cached page is restored`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');

    assert.match(
      source,
      /window\.addEventListener\('pageshow',[\s\S]*?renderPage\(\)/
    );
    assert.match(
      source,
      /document\.addEventListener\('visibilitychange',[\s\S]*?!document\.hidden[\s\S]*?renderPage\(\)/
    );
    assert.match(
      source,
      /window\.addEventListener\('storage',[\s\S]*?little-red-flower-calendar-v1[\s\S]*?renderPage\(\)/
    );
  });
}
