"use strict";

function readStdin() {
  if (process.stdin.isTTY) {
    return Promise.resolve("");
  }

  return new Promise((resolve, reject) => {
    let data = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  await readStdin();

  process.stdout.write("Git Gandalf Review\n(no analysis yet)\n");
  process.exit(0);
}

main().catch(() => {
  process.stderr.write("Git Gandalf failed\n");
  process.exit(1);
});
