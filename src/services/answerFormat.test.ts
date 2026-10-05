import { describe, it, expect } from "vitest";
import { splitInlineBullets } from "./answerFormat";

describe("splitInlineBullets", () => {
  it("puts inline bullet points on their own lines", () => {
    expect(splitInlineBullets("Takeaway. - One. - Two. - Three.")).toBe("Takeaway.\n- One.\n- Two.\n- Three.");
  });

  it("leaves a single dash in a sentence alone", () => {
    const text = "It rained. - which nobody expected - and then it stopped.";
    expect(splitInlineBullets(text)).toBe(text);
  });

  it("leaves real lists and plain prose unchanged", () => {
    const list = "Takeaway.\n- One.\n- Two.";
    expect(splitInlineBullets(list)).toBe(list);
    expect(splitInlineBullets("A well-known fact - really.")).toBe("A well-known fact - really.");
  });
});
