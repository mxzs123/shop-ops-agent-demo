import { strict as assert } from "node:assert";

import { hasExplicitConfirmation } from "../src/confirmation";

const confirmed = [
  "确认",
  "确认执行",
  "确定",
  "可以",
  "可以执行",
  "好的",
  "好",
  "好，执行",
  "没问题",
  "同意",
  "批准",
  "执行吧",
  "继续",
  "ok",
  "OK，执行",
  "好的，没问题",
];

const rejected = [
  "",
  "   ",
  "先别执行了",
  "别改了",
  "这个不太好，先别改",
  "不可以",
  "不确定",
  "我不确定要不要改",
  "不要执行",
  "不执行",
  "取消",
  "撤销",
  "算了",
  "再想想",
  "再看看",
  "等一下",
  "暂不执行",
  "暂停",
  "停止执行",
  "请勿执行",
  "book",
  "look at it",
  "no",
  "not now",
  "随便看看", // no confirmation word at all
];

for (const text of confirmed) {
  assert.equal(
    hasExplicitConfirmation(text),
    true,
    `should be treated as confirmation: ${JSON.stringify(text)}`,
  );
}

for (const text of rejected) {
  assert.equal(
    hasExplicitConfirmation(text),
    false,
    `should NOT be treated as confirmation: ${JSON.stringify(text)}`,
  );
}

console.log("ok - confirmation gate");
