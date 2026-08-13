import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-fuzzy.ts");
}

test("builds closed file mentions and quotes paths containing spaces", async () => {
  const { buildAtMentionText, buildFileAtMentionsText } = await loadSubject();

  assert.equal(buildAtMentionText("notes/todo.md", false), "@notes/todo.md ");
  assert.equal(buildAtMentionText("project files/design brief.md", false), "@\"project files/design brief.md\" ");
  assert.equal(
    buildFileAtMentionsText(["notes/todo.md", "project files/design brief.md"]),
    "@notes/todo.md @\"project files/design brief.md\" ",
  );
});

test("builds line-scoped file mentions", async () => {
  const { buildFileLineMentionText } = await loadSubject();

  assert.equal(buildFileLineMentionText("src/app.ts", 12, 12), "@src/app.ts:12 ");
  assert.equal(buildFileLineMentionText("src/app.ts", 18, 12), "@src/app.ts:12-18 ");
  assert.equal(
    buildFileLineMentionText("project files/app.ts", 3, 9),
    "@\"project files/app.ts\":3-9 ",
  );
  assert.equal(buildFileLineMentionText("src/app.ts", 0, 0), "@src/app.ts:1 ");
});

test("relativePathForMention resolves dropped file paths against the cwd", async () => {
  const { relativePathForMention } = await loadSubject();

  // Null/empty input is skipped (pure browser without file.path).
  assert.equal(relativePathForMention(undefined, "D:/repo"), null);
  assert.equal(relativePathForMention(null, "D:/repo"), null);
  assert.equal(relativePathForMention("", "D:/repo"), null);

  // No cwd: forward-slash absolute path is returned as-is.
  assert.equal(relativePathForMention("D:/repo/src/app.ts", null), "D:/repo/src/app.ts");

  // Within cwd (Windows, case-insensitive drive + segments): relative.
  assert.equal(
    relativePathForMention("D:\\repo\\src\\app.ts", "D:/repo"),
    "src/app.ts",
  );
  assert.equal(
    relativePathForMention("d:/REPO/Src/App.ts", "D:\\repo"),
    "Src/App.ts",
  );

  // The cwd itself collapses to ".".
  assert.equal(relativePathForMention("D:/repo", "D:\\repo"), ".");

  // Outside cwd: forward-slash absolute path preserved so the user can edit.
  assert.equal(
    relativePathForMention("C:/Users/me/notes.txt", "D:/repo"),
    "C:/Users/me/notes.txt",
  );

  // POSIX paths (no drive letter) compare case-sensitively.
  assert.equal(
    relativePathForMention("/home/me/repo/lib/util.ts", "/home/me/repo"),
    "lib/util.ts",
  );
  assert.equal(
    relativePathForMention("/home/ME/repo/lib/util.ts", "/home/me/repo"),
    "/home/ME/repo/lib/util.ts",
  );
});
