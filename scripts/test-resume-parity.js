const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { textFromHtml } = require("./lib/public-discovery");

// The web résumé and the PDF are designed separately, so their wording is kept
// in step through the structured record both are written from.
const ROOT_DIR = path.join(__dirname, "..");
const record = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "assets", "data", "resume-android.json"), "utf8"));
const SOURCES = Object.freeze({
  "web résumé (resume.html)": "resume.html",
  "PDF source (applications/resume.html)": path.join("applications", "resume.html")
});

const normalize = (value) => String(value).replace(/\s+[-–—]\s+/g, " — ").replace(/\s+/g, " ").trim();

for (const [label, relativePath] of Object.entries(SOURCES)) {
  const text = normalize(textFromHtml(fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8")));
  const lowerText = text.toLowerCase();
  const missing = [];
  const expect = (value) => {
    if (!text.includes(normalize(value))) missing.push(value);
  };

  let previousRole = -1;
  for (const role of record.experience) {
    [role.title, role.company, role.dates, ...role.projects, ...role.bullets].forEach(expect);
    const position = text.indexOf(normalize(role.bullets[0]));
    assert(position > previousRole, `${label} lists ${role.company} out of the record's order.`);
    previousRole = position;
  }
  for (const group of record.skills) {
    for (const item of group.items) {
      if (!lowerText.includes(item.toLowerCase())) missing.push(item);
    }
  }
  if (relativePath.startsWith("applications")) {
    for (const project of record.projects) [project.name, project.description].forEach(expect);
  }

  assert.deepStrictEqual(missing, [], `${label} has drifted from assets/data/resume-android.json.`);
}

console.log("Web résumé and PDF source match the résumé record: 7 roles, 21 bullets, skills, and PDF projects.");
