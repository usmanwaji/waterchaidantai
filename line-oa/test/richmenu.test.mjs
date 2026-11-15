import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../setup-richmenu.mjs";

const MENU = JSON.parse(readFileSync(new URL("../richmenu.json", import.meta.url), "utf8"));
const IMAGE = { name: "richmenu.png", buf: readFileSync(new URL("../richmenu.png", import.meta.url)) };

test("committed rich menu passes validation", () => {
  assert.deepEqual(validate(MENU, IMAGE), []);
});

test("rich menu layout follows the plan", () => {
  const actions = MENU.areas.map((a) => a.action);
  assert.deepEqual(actions.map((a) => a.type), ["message", "uri", "uri", "uri", "uri", "uri"]);
  assert.equal(actions[0].text, "สถานการณ์น้ำ");
  assert.equal(actions[1].uri, "https://line.me/R/nv/location/");
  assert.equal(actions[5].uri, "tel:1784");
});

test("validation catches overlap, gaps, long labels, wrong image size", () => {
  const bad = structuredClone(MENU);
  bad.areas[1].bounds.x = 800;
  bad.areas[2].action.label = "ป้ายที่ยาวเกินยี่สิบตัวอักษรแน่นอน";
  bad.areas.pop();
  const errs = validate(bad, { name: "x.png", buf: IMAGE.buf.subarray(0, 24) }).join("\n");
  assert.match(errs, /ทับกับ/);
  assert.match(errs, /ไม่เต็มรูป/);
  assert.match(errs, /label ยาว/);
  const small = Buffer.from(IMAGE.buf);
  small.writeUInt32BE(1000, 16);
  assert.match(validate(MENU, { name: "x.png", buf: small }).join(), /ไม่ตรงกับ size/);
});
