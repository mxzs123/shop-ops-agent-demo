// Defense-in-depth check that the user's latest message explicitly confirms a
// write. This is intentionally conservative: any refusal/cancellation/hesitation
// intent blocks execution even when a confirmation word also appears, and
// confirmation words are matched with boundaries so substrings like "不可以" or
// the English word "book" do not falsely pass.

// Refusal, cancellation, or "not sure" intent. Checked first so a negated
// confirmation word (e.g. "不确定", "先别执行") never falls through as confirmed.
// English negations use \b so they only match standalone words.
const NEGATION_PATTERN =
  /不确认|不确定|不一定|不要|不用|不可以|不行|不对|不能|不准|不必|不急|不成|不执行|别改|别动|别执行|别删|别上|别下|别弄|别急|先别|先不|暂时不|暂不|暂停|停止|取消|撤销|算了|回退|勿|等一下|等等|等会|稍等|再想|再看|再确认|再核|再议|再说|停一下|\bno\b|\bnot\b|\bcancel\b|\bstop\b|\bwait\b/i;

// Affirmative intent. Bare "好" must sit at a boundary so "好奇"/"好处" do not
// match, and the English "ok"/"yes" use \b so "book"/"look" do not match.
const CONFIRMATION_PATTERN =
  /确认|确定|执行|没问题|可以|同意|批准|继续|批量执行|好的|(^|[\s，,。.！!、])好([\s，,。.！!的吧]|$)|\bok\b|\byes\b|\bconfirm\b/i;

export function hasExplicitConfirmation(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  if (NEGATION_PATTERN.test(normalized)) {
    return false;
  }

  return CONFIRMATION_PATTERN.test(normalized);
}
