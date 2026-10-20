import { describe, it, expect } from "vitest";
import {
  htmlToText,
  stripQuotedReplies,
  stripSignatures,
  cleanEmailBody,
} from "../src/lib/body-cleaner";

describe("BodyCleaner", () => {
  it("converts HTML to plain text and decodes entities", () => {
    const html = `
      <div>
        <p>Hello &amp; welcome to <strong>Acme</strong>!</p>
        <p>Interview scheduled on &quot;Next Monday&quot;.<br>Please confirm.</p>
      </div>
    `;

    const text = htmlToText(html);
    expect(text).toContain("Hello & welcome to Acme!");
    expect(text).toContain('Interview scheduled on "Next Monday".');
    expect(text).toContain("Please confirm.");
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("<strong>");
  });

  it("strips quoted replies ('On ... wrote:', '>', '--- Original Message ---')", () => {
    const emailWithQuotes = `
Thank you for your response. Let's schedule for Wednesday 2 PM.

On Mon, Nov 2, 2026 at 10:15 AM John Recruiter <john@acme.com> wrote:
> Hi Candidate,
> Are you available this week for an interview?
> Best,
> John
    `;

    const cleaned = stripQuotedReplies(emailWithQuotes);
    expect(cleaned).toContain("Let's schedule for Wednesday 2 PM.");
    expect(cleaned).not.toContain("Are you available this week");
    expect(cleaned).not.toContain("John Recruiter <john@acme.com> wrote:");
  });

  it("strips standard email signatures and device footers", () => {
    const emailWithSig = `
Hi Jane,

Please find the assessment link below.

-- 
John Recruiter
Senior Talent Partner, Google
+1-555-0199
    `;

    const cleaned = stripSignatures(emailWithSig);
    expect(cleaned).toContain("Please find the assessment link below.");
    expect(cleaned).not.toContain("Senior Talent Partner");
  });

  it("truncates content exceeding maxChars limit", () => {
    const longText = "A".repeat(1000);
    const cleaned = cleanEmailBody(longText, false, 500);

    expect(cleaned.length).toBe(500);
  });
});
