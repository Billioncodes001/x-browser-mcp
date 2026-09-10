import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

async function openReview(page: Page, label = "Synthetic partial research") {
  await page.goto("/#collections");
  await page.getByRole("link", { name: new RegExp(label) }).click();
  const panel = page.getByRole("region", { name: "Reviewed research export" });
  await panel.getByRole("button", { name: "Prepare reviewed export" }).click();
  return panel;
}

for (const width of [1440, 390]) {
  test(`reviewed JSON and CSV downloads preserve the selected synthetic evidence at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    const external: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1") {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const panel = await openReview(page);
    await expect(panel).toContainText("3 captured copies");
    await expect(panel).toContainText("1 identical duplicate copies collapsed");
    await expect(panel).toContainText("0 selected");
    await expect(panel).toContainText("Collection was blocked");
    const downloadButton = panel.getByRole("button", {
      name: "Download reviewed export",
    });
    const acknowledgement = panel.getByLabel(/I reviewed this selection/);
    const note = panel.getByLabel("Researcher selection note");
    await expect(downloadButton).toBeDisabled();
    await panel.getByRole("button", { name: "Select all records" }).click();
    await expect(panel).toContainText("2 selected");
    await panel.getByRole("button", { name: "Clear selection" }).click();
    await expect(panel).toContainText("0 selected");
    await panel.getByLabel("Include record review-1", { exact: true }).check();
    await note.fill(
      "Synthetic first observation selected; blocked collection may omit relevant records.",
    );
    await expect(downloadButton).toBeDisabled();
    await acknowledgement.check();
    await expect(downloadButton).toBeEnabled();
    await note.fill(
      "Synthetic first observation selected; missing records do not establish deletion.",
    );
    await expect(acknowledgement).not.toBeChecked();
    await acknowledgement.check();
    await panel.getByLabel("Include record review-2", { exact: true }).check();
    await expect(acknowledgement).not.toBeChecked();
    await panel
      .getByLabel("Include record review-2", { exact: true })
      .uncheck();
    await acknowledgement.check();
    await expect(panel).toContainText("1 selected");
    await expect(panel).toContainText("1 excluded");
    // Filtering the original records must not silently change the explicit handoff selection.
    await page.getByLabel("Filter records").fill("not a matching observation");
    await expect(panel).toContainText("1 selected");
    await page.getByLabel("Filter records").fill("");
    const pendingJson = page.waitForEvent("download");
    await downloadButton.click();
    const json = await pendingJson;
    expect(json.suggestedFilename()).toMatch(/^x-reviewed-.*\.json$/);
    const packet = JSON.parse(await readFile((await json.path())!, "utf8"));
    expect(packet.records).toEqual([
      {
        record: {
          id: "review-1",
          text: "Synthetic field observation for a reviewed handoff.",
          url: "https://x.com/fixture_user/status/501",
        },
        originalIndices: [0, 1],
      },
    ]);
    expect(packet.provenance.complete).toBe(false);
    expect(packet.provenance.stopReason).toBe("blocked");
    expect(packet.provenance.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(packet.selection).toMatchObject({
      rawCount: 3,
      uniqueCount: 2,
      selectedCount: 1,
      excludedUniqueCount: 1,
      duplicateCopies: 1,
    });
    expect(packet.warnings.join(" ")).toContain(
      "No live X account was contacted",
    );
    await expect(panel.getByRole("status")).toContainText(
      "Original collection unchanged",
    );
    await panel.getByLabel("Reviewed export format").selectOption("csv");
    const pendingCsv = page.waitForEvent("download");
    await downloadButton.click();
    const csv = await pendingCsv;
    const body = await readFile((await csv.path())!, "utf8");
    expect(body).toContain('"snapshot_sha256"');
    expect(body).toContain(packet.provenance.snapshotDigest);
    expect(body).toContain(packet.review.note);
    expect(body).toContain("Synthetic checkpoint");
    expect(body).not.toContain("synthetic unrelated record");
    await expect(panel.getByRole("status")).toContainText(
      "CSV export downloaded",
    );
    await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.failureSummary),
      })),
    ).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/review-export-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Reviewed research export" }),
    ).not.toContainText(packet.review.note);
  });
}

test("stale-source failure retains the note but requires a fresh preview and selection", async ({
  page,
}) => {
  const panel = await openReview(page);
  const note = panel.getByLabel("Researcher selection note");
  const acknowledgement = panel.getByLabel(/I reviewed this selection/);
  await panel.getByLabel("Include record review-1", { exact: true }).check();
  await note.fill(
    "Synthetic selection note retained after a stale preview response.",
  );
  await acknowledgement.check();
  await page.route("**/api/review-export", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "REVIEW_STALE",
        message:
          "The saved snapshot changed. Reload the preview and review the selection again.",
      }),
    }),
  );
  await panel.getByRole("button", { name: "Download reviewed export" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "saved snapshot changed",
  );
  await expect(note).toHaveValue(
    "Synthetic selection note retained after a stale preview response.",
  );
  await expect(acknowledgement).not.toBeChecked();
  await page.unroute("**/api/review-export");
  await panel.getByRole("button", { name: "Reload review preview" }).click();
  await expect(
    panel.getByLabel("Include record review-1", { exact: true }),
  ).not.toBeChecked();
  await expect(note).toHaveValue(
    "Synthetic selection note retained after a stale preview response.",
  );
  await expect(
    panel.getByRole("button", { name: "Download reviewed export" }),
  ).toBeDisabled();
  await panel.getByLabel("Include record review-1", { exact: true }).check();
  await acknowledgement.check();
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download reviewed export" }).click();
  await download;
  await expect(panel.getByRole("status")).toContainText("export downloaded");
});

test("empty samples and conflicting saved copies cannot be handed off as reviewed evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const empty = await openReview(page, "Synthetic empty collection");
  await expect(empty).toContainText("No records are available for selection");
  await expect(
    empty.getByRole("button", { name: "Download reviewed export" }),
  ).toBeDisabled();
  const conflict = await openReview(page, "Synthetic conflicting copies");
  await expect(conflict.getByRole("alert")).toContainText(
    "conflicting saved copies",
  );
  await expect(
    conflict.getByRole("button", { name: "Download reviewed export" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "JSON", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
