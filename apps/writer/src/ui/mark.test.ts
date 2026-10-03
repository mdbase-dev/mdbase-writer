import { getMdbaseMarkActivity, resetMdbaseMarkActivity } from "@mdbase-dev/ui/mark-activity";
import { afterEach, describe, expect, it } from "vitest";

import { fail, ok } from "../backend/types.js";
import { signalFailure, signalResult } from "./mark.js";

const played = () => getMdbaseMarkActivity().signal?.kind ?? null;

afterEach(() => resetMdbaseMarkActivity());

describe("the app mark's reactions to writes", () => {
  it("plays a write's outcome and hands the result on", () => {
    const done = ok("comments/one.md");
    expect(signalResult(done)).toBe(done);
    expect(played()).toBe("saved");
    resetMdbaseMarkActivity();
    signalResult(fail("Denied"));
    expect(played()).toBe("error");
  });
  it("leaves a write that edits text to its autosave, except when it fails", () => {
    const added = ok("chapters/two.md");
    expect(signalFailure(added)).toBe(added);
    expect(played()).toBeNull();
    signalFailure(fail("The chapter could not be created."));
    expect(played()).toBe("error");
  });
});
