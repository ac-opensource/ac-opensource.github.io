const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { DEFAULT_DB_PATH } = require("./lib/blog-db");

const SERVER_SCRIPT = path.join(__dirname, "blog-writer-server.js");

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Writer exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response;
    } catch (_error) {
      // The loopback listener may not be ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Timed out waiting for the local writer.");
}

async function expectStatus(responsePromise, expected, label) {
  const response = await responsePromise;
  if (response.status !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${response.status}.`);
  }
  return response;
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac-blog-writer-test-"));
  const testDatabase = path.join(tempRoot, "blog.sqlite");
  fs.copyFileSync(DEFAULT_DB_PATH, testDatabase);

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      WRITER_HOST: "127.0.0.1",
      BLOG_DB_PATH: testDatabase
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    const health = await waitForHealth(baseUrl, child);
    const healthBody = await health.text();
    if (healthBody.includes(testDatabase) || healthBody.includes(".sqlite")) {
      throw new Error("Health response disclosed the database path or filename.");
    }
    await expectStatus(
      fetch(`${baseUrl}/assets/data/blog.sqlite`),
      404,
      "authoring database static route"
    );

    const writerResponse = await expectStatus(fetch(`${baseUrl}/`), 200, "writer page");
    const cookie = String(writerResponse.headers.get("set-cookie") || "").split(";")[0];
    if (!cookie.startsWith("ac_writer_session=")) {
      throw new Error("Writer page did not establish a local mutation session.");
    }

    const postBody = JSON.stringify({
      title: "Writer security test",
      published_date: "2099-01-01",
      status: "hidden",
      body_html: "<p>Temporary test row.</p>"
    });

    await expectStatus(
      fetch(`${baseUrl}/api/posts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: postBody
      }),
      403,
      "mutation without writer session"
    );

    await expectStatus(
      fetch(`${baseUrl}/api/posts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: "https://example.test"
        },
        body: postBody
      }),
      403,
      "mutation from a foreign origin"
    );

    const saved = await expectStatus(
      fetch(`${baseUrl}/api/posts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: baseUrl
        },
        body: postBody
      }),
      200,
      "same-origin writer mutation"
    );
    const payload = await saved.json();
    const slug = payload && payload.post && payload.post.slug;
    if (!slug) throw new Error("Authorized writer mutation did not return a slug.");

    await expectStatus(
      fetch(`${baseUrl}/api/posts/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: { cookie, origin: baseUrl }
      }),
      200,
      "same-origin writer cleanup"
    );

    const logs = output.join("");
    if (logs.includes(testDatabase)) {
      throw new Error("Writer startup output disclosed the database path.");
    }

    console.log("Verified loopback writer session, origin checks, and path redaction.");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        child.once("exit", resolve);
        setTimeout(resolve, 2000);
      }
    });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
